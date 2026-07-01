/**
 * projects/io.ts — File I/O and locking for projects.json.
 */
import fs from "node:fs/promises";
import { ensureWorkspaceMigrated } from "../../setup/migrate-layout.js";
import type { ProjectsData, Project } from "../../domain/projects/types.js";
import { projectsPath, resolveRepoPath } from "./paths.js";


// ---------------------------------------------------------------------------
// File locking — prevents concurrent read-modify-write races
// ---------------------------------------------------------------------------

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 10_000;

function lockPath(workspaceDir: string): string {
  return projectsPath(workspaceDir) + ".lock";
}

export async function acquireLock(workspaceDir: string): Promise<void> {
  const lock = lockPath(workspaceDir);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      await fs.writeFile(lock, String(Date.now()), { flag: "wx" });
      return;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "EEXIST") throw err;

      // Check for stale lock
      try {
        const content = await fs.readFile(lock, "utf-8");
        const lockTime = Number(content);
        if (Date.now() - lockTime > LOCK_STALE_MS) {
          try { await fs.unlink(lock); } catch { /* race */ }
          continue;
        }
      } catch { /* lock disappeared — retry */ }

      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }

  // Last resort: force remove potentially stale lock
  try { await fs.unlink(lockPath(workspaceDir)); } catch { /* ignore */ }
  await fs.writeFile(lock, String(Date.now()), { flag: "wx" });
}

export async function releaseLock(workspaceDir: string): Promise<void> {
  try { await fs.unlink(lockPath(workspaceDir)); } catch { /* already removed */ }
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export async function readProjects(workspaceDir: string): Promise<ProjectsData> {
  await ensureWorkspaceMigrated(workspaceDir);
  const raw = await fs.readFile(projectsPath(workspaceDir), "utf-8");
  return JSON.parse(raw) as ProjectsData;
}

export async function writeProjects(
  workspaceDir: string,
  data: ProjectsData,
): Promise<void> {
  const filePath = projectsPath(workspaceDir);
  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  await fs.rename(tmpPath, filePath);
}

/** Resolve a project by slug or channelId. Returns the slug of the found project. */
export function resolveProjectSlug(
  data: ProjectsData,
  slugOrChannelId: string,
): string | undefined {
  // Direct lookup by slug
  if (data.projects[slugOrChannelId]) {
    return slugOrChannelId;
  }

  // Reverse lookup by channelId in current project-first schema.
  for (const [slug, project] of Object.entries(data.projects)) {
    if (project.channels.some(ch => ch.channelId === slugOrChannelId)) {
      return slug;
    }
  }

  return undefined;
}

/**
 * Get a project by slug or channelId.
 */
export function getProject(
  data: ProjectsData,
  slugOrChannelId: string,
): Project | undefined {
  const slug = resolveProjectSlug(data, slugOrChannelId);
  return slug ? data.projects[slug] : undefined;
}

/**
 * Read projects.json and return a single project by slug.
 * Convenience wrapper around readProjects + getProject.
 */
export async function loadProjectBySlug(
  workspaceDir: string,
  slug: string,
): Promise<Project | undefined> {
  const data = await readProjects(workspaceDir);
  return getProject(data, slug);
}

export { resolveRepoPath };
