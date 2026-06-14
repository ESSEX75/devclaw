/**
 * sprints/state.ts — File-backed local sprint execution graph.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../setup/migrate-layout.js";
import { log as auditLog } from "../audit.js";
import {
  SprintGraphStatus,
  SprintStepStatus,
  type SprintExecutionGraph,
  type SprintReadinessResolution,
  type SprintStep,
  type SprintsData,
} from "./types.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 10_000;

function sprintsPath(workspaceDir: string): string {
  return path.join(workspaceDir, DATA_DIR, "sprints.json");
}

function lockPath(workspaceDir: string): string {
  return sprintsPath(workspaceDir) + ".lock";
}

export function sprintKey(projectSlug: string, sprintRootIssueId: number): string {
  return `${projectSlug}:${sprintRootIssueId}`;
}

async function acquireLock(workspaceDir: string): Promise<void> {
  const lock = lockPath(workspaceDir);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      await fs.mkdir(path.dirname(lock), { recursive: true });
      await fs.writeFile(lock, String(Date.now()), { flag: "wx" });
      return;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "EEXIST") throw err;

      try {
        const content = await fs.readFile(lock, "utf-8");
        if (Date.now() - Number(content) > LOCK_STALE_MS) {
          await fs.unlink(lock).catch(() => {});
          continue;
        }
      } catch {
        // Lock disappeared between attempts.
      }

      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }

  await fs.unlink(lock).catch(() => {});
  await fs.writeFile(lock, String(Date.now()), { flag: "wx" });
}

async function releaseLock(workspaceDir: string): Promise<void> {
  await fs.unlink(lockPath(workspaceDir)).catch(() => {});
}

export async function readSprints(workspaceDir: string): Promise<SprintsData> {
  try {
    const raw = await fs.readFile(sprintsPath(workspaceDir), "utf-8");
    return JSON.parse(raw) as SprintsData;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { sprints: {} };
    }
    throw err;
  }
}

export async function writeSprints(workspaceDir: string, data: SprintsData): Promise<void> {
  const filePath = sprintsPath(workspaceDir);
  const tmpPath = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  await fs.rename(tmpPath, filePath);
}

export async function createSprintGraph(
  workspaceDir: string,
  graph: Omit<SprintExecutionGraph, "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  },
): Promise<SprintExecutionGraph> {
  await acquireLock(workspaceDir);
  try {
    const data = await readSprints(workspaceDir);
    const key = sprintKey(graph.projectSlug, graph.sprintRootIssueId);
    const now = new Date().toISOString();
    const next: SprintExecutionGraph = {
      ...graph,
      createdAt: graph.createdAt ?? now,
      updatedAt: graph.updatedAt ?? now,
    };
    data.sprints[key] = normalizeGraph(next);
    await writeSprints(workspaceDir, data);
    await auditLog(workspaceDir, "sprint_graph_create", {
      projectSlug: next.projectSlug,
      sprintRootIssueId: next.sprintRootIssueId,
      stepIssueIds: next.steps.map((step) => step.issueId),
    });
    return data.sprints[key]!;
  } finally {
    await releaseLock(workspaceDir);
  }
}

export async function getSprintGraph(
  workspaceDir: string,
  projectSlug: string,
  sprintRootIssueId: number,
): Promise<SprintExecutionGraph | undefined> {
  const data = await readSprints(workspaceDir);
  return data.sprints[sprintKey(projectSlug, sprintRootIssueId)];
}

export async function listSprintGraphs(
  workspaceDir: string,
  projectSlug?: string,
): Promise<SprintExecutionGraph[]> {
  const data = await readSprints(workspaceDir);
  const graphs = Object.values(data.sprints);
  return projectSlug ? graphs.filter((graph) => graph.projectSlug === projectSlug) : graphs;
}

export async function updateSprintStepStatus(
  workspaceDir: string,
  projectSlug: string,
  sprintRootIssueId: number,
  issueId: number,
  status: SprintStepStatus,
  opts?: { prUrl?: string; event?: string },
): Promise<SprintExecutionGraph> {
  await acquireLock(workspaceDir);
  try {
    const data = await readSprints(workspaceDir);
    const key = sprintKey(projectSlug, sprintRootIssueId);
    const graph = data.sprints[key];
    if (!graph) throw new Error(`Sprint graph not found: ${key}`);
    const step = graph.steps.find((candidate) => candidate.issueId === issueId);
    if (!step) throw new Error(`Sprint step #${issueId} not found in ${key}`);

    step.status = status;
    step.updatedAt = new Date().toISOString();
    if (opts?.prUrl !== undefined) step.prUrl = opts.prUrl;
    graph.updatedAt = step.updatedAt;
    data.sprints[key] = normalizeGraph(graph);
    await writeSprints(workspaceDir, data);

    if (opts?.event) {
      await auditLog(workspaceDir, opts.event, {
        projectSlug,
        sprintRootIssueId,
        issueId,
        status,
      });
    }
    return data.sprints[key]!;
  } finally {
    await releaseLock(workspaceDir);
  }
}

export async function markStepDispatched(
  workspaceDir: string,
  projectSlug: string,
  sprintRootIssueId: number,
  issueId: number,
): Promise<SprintExecutionGraph> {
  return updateSprintStepStatus(
    workspaceDir,
    projectSlug,
    sprintRootIssueId,
    issueId,
    SprintStepStatus.ACTIVE,
    { event: "sprint_step_dispatch" },
  );
}

export async function markStepBlocked(
  workspaceDir: string,
  projectSlug: string,
  sprintRootIssueId: number,
  issueId: number,
): Promise<SprintExecutionGraph> {
  return updateSprintStepStatus(
    workspaceDir,
    projectSlug,
    sprintRootIssueId,
    issueId,
    SprintStepStatus.BLOCKED,
    { event: "sprint_step_block" },
  );
}

export async function markStepUnblocked(
  workspaceDir: string,
  projectSlug: string,
  sprintRootIssueId: number,
  issueId: number,
): Promise<SprintExecutionGraph> {
  return updateSprintStepStatus(
    workspaceDir,
    projectSlug,
    sprintRootIssueId,
    issueId,
    SprintStepStatus.READY,
    { event: "sprint_step_unblock" },
  );
}

export async function markStepMerged(
  workspaceDir: string,
  projectSlug: string,
  sprintRootIssueId: number,
  issueId: number,
  opts?: { prUrl?: string },
): Promise<SprintExecutionGraph> {
  return updateSprintStepStatus(
    workspaceDir,
    projectSlug,
    sprintRootIssueId,
    issueId,
    SprintStepStatus.MERGED,
    { event: "sprint_step_merge", prUrl: opts?.prUrl },
  );
}

export async function markSprintRepaired(
  workspaceDir: string,
  projectSlug: string,
  sprintRootIssueId: number,
  integrityErrors: string[] = [],
): Promise<SprintExecutionGraph> {
  await acquireLock(workspaceDir);
  try {
    const data = await readSprints(workspaceDir);
    const key = sprintKey(projectSlug, sprintRootIssueId);
    const graph = data.sprints[key];
    if (!graph) throw new Error(`Sprint graph not found: ${key}`);
    graph.status = SprintGraphStatus.ACTIVE;
    graph.updatedAt = new Date().toISOString();
    data.sprints[key] = normalizeGraph(graph);
    await writeSprints(workspaceDir, data);
    await auditLog(workspaceDir, "sprint_graph_repair", {
      projectSlug,
      sprintRootIssueId,
      integrityErrors,
    });
    return data.sprints[key]!;
  } finally {
    await releaseLock(workspaceDir);
  }
}

export function resolveStepReadiness(
  graph: SprintExecutionGraph,
  issueId: number,
): SprintReadinessResolution {
  const step = graph.steps.find((candidate) => candidate.issueId === issueId);
  if (!step) return { ready: false, blockedBy: [], reason: "missing_step" };

  if (graph.sprintBlockedBy.length > 0) {
    return { ready: false, blockedBy: [...graph.sprintBlockedBy], reason: "sprint_blocked" };
  }

  if (step.status === SprintStepStatus.ACTIVE || step.status === SprintStepStatus.REVIEW) {
    return { ready: false, blockedBy: [], reason: "already_active" };
  }

  if (isTerminalStepStatus(step.status)) {
    return { ready: false, blockedBy: [], reason: "terminal" };
  }

  const unresolved = (step.blockedBy ?? []).filter((dependencyIssueId) => {
    const dependency = graph.steps.find((candidate) => candidate.issueId === dependencyIssueId);
    return !dependency || !isSatisfiedDependencyStatus(dependency.status);
  });

  if (unresolved.length > 0) {
    return { ready: false, blockedBy: unresolved, reason: "step_blocked" };
  }

  return { ready: true, blockedBy: [], reason: "ready" };
}

export function getReadySprintSteps(graph: SprintExecutionGraph): SprintStep[] {
  return graph.steps
    .filter((step) => resolveStepReadiness(graph, step.issueId).ready)
    .sort((a, b) => a.order - b.order);
}

export function normalizeGraph(graph: SprintExecutionGraph): SprintExecutionGraph {
  return {
    ...graph,
    sprintBlockedBy: [...new Set(graph.sprintBlockedBy ?? [])],
    steps: graph.steps
      .map((step) => ({
        ...step,
        blockedBy: [...new Set(step.blockedBy ?? [])],
      }))
      .sort((a, b) => a.order - b.order),
  };
}

function isSatisfiedDependencyStatus(status: SprintStepStatus): boolean {
  return status === SprintStepStatus.MERGED || status === SprintStepStatus.DONE;
}

function isTerminalStepStatus(status: SprintStepStatus): boolean {
  return status === SprintStepStatus.MERGED ||
    status === SprintStepStatus.DONE ||
    status === SprintStepStatus.CONFLICT ||
    status === SprintStepStatus.FINAL_REVIEW_REQUIRED ||
    status === SprintStepStatus.INTEGRITY_ERROR;
}
