/**
 * projects/io.ts — File I/O and locking for projects.json.
 */
import fs from "node:fs/promises";

import type { Project } from "../../domain/index.js";
import { withFileLock, writeJsonAtomic } from "../persistence/index.js";
import { projectsPath, resolveRepoPath } from "./paths.js";
import { parseProjectsData } from "./schema.js";
import type { ProjectsData } from "./types.js";


// ---------------------------------------------------------------------------
// File locking — prevents concurrent read-modify-write races
// ---------------------------------------------------------------------------

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 10_000;

function lockPath(workspaceDir: string): string {
  return projectsPath(workspaceDir) + ".lock";
}

/**
 * Run a projects repository operation under its per-workspace lock.
 *
 * @param workspaceDir - Workspace containing the project registry.
 * @param operation - Repository work to serialize.
 */
export async function withProjectsLock<T>(workspaceDir: string, operation: () => T | Promise<T>): Promise<T> {
  return withFileLock(
    lockPath(workspaceDir),
    { retryMs: LOCK_RETRY_MS, staleMs: LOCK_STALE_MS, timeoutMs: LOCK_TIMEOUT_MS },
    operation,
  );
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export async function readProjects(workspaceDir: string): Promise<ProjectsData> {
  const raw = await fs.readFile(projectsPath(workspaceDir), "utf-8");

  const parsed: unknown = JSON.parse(raw);

  return parseProjectsData(parsed);
}

export async function writeProjects(
  workspaceDir: string,
  data: ProjectsData,
): Promise<void> {
  const filePath = projectsPath(workspaceDir);
  const validated = parseProjectsData(data);

  await writeJsonAtomic(filePath, validated);
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
