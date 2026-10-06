/** Recovers project-slot release after a workflow transition committed its local intent. */

import type { ActiveIssueWorker, Project } from "../../domain/index.js";
import { readIssueStateStore, updateIssueRuntimeRecord, updateProjects, withIssueOrchestrationLock } from "../../state/index.js";

/** Capture the project slot identity before committing the transition.
 * @param project - Fresh registry snapshot, absent for a workspace without workers.
 * @param issueId - Issue whose completing worker is selected.
 */
export function findTransitionWorker(project: Project | undefined, issueId: number): ActiveIssueWorker | null {
  for (const [role, worker] of Object.entries(project?.workers ?? {})) {
    for (const [level, slots] of Object.entries(worker.levels)) {
      if (!slots) continue;
      const slotIndex = slots.findIndex((slot) => slot.issueId === issueId);
      const slot = slots[slotIndex];

      if (slot) return { role, level, slotIndex, sessionKey: slot.sessionKey, startedAt: slot.startTime ?? "" };
    }
  }

  return null;
}

/** Release only the committed worker identity; replay after either local write is safe.
 * The caller holds the issue lock. A replacement run is never released.
 * @param workspaceDir - Workspace containing both local ownership stores.
 * @param projectSlug - Canonical project identity.
 * @param issueId - Issue with a committed release intent.
 */
export async function releaseTransitionWorkerLocked(workspaceDir: string, projectSlug: string, issueId: number): Promise<void> {
  const state = (await readIssueStateStore(workspaceDir, projectSlug)).issues[String(issueId)];
  const pending = state?.pendingWorkerRelease;

  if (!pending) return;
  await updateProjects(workspaceDir, (current) => {
    const data = structuredClone(current);
    const project = data.projects[projectSlug];

    if (!project) throw new Error(`Project ${projectSlug} is missing during worker release.`);
    const slots = project.workers[pending.role]?.levels[pending.level];
    const slot = slots?.[pending.slotIndex];

    if (slots && slot?.issueId === issueId) {
      if (slot.sessionKey !== pending.sessionKey || (slot.startTime ?? "") !== pending.startedAt) {
        throw new Error(`Issue #${issueId} has a replacement worker; inspect ownership before releasing it.`);
      }

      slots[pending.slotIndex] = {
        active: false, issueId: null, sessionKey: slot.sessionKey, startTime: null,
        previousLabel: null, name: slot.name, lastIssueId: issueId,
      };
    }

    return { data, result: undefined };
  });
  await updateIssueRuntimeRecord(workspaceDir, projectSlug, issueId, (current) => {
    if (!current) throw new Error(`Issue #${issueId} disappeared during worker release.`);

    return { ...current, pendingWorkerRelease: null, updatedAt: new Date().toISOString() };
  });
}

/** Resume a bounded batch before terminal notification and archive maintenance.
 * @param workspaceDir - Workspace containing committed release intents.
 * @param projectSlug - Project whose transitions are recovered.
 * @param maxItems - Maximum release intents examined during this pass.
 */
export async function recoverTransitionWorkers(workspaceDir: string, projectSlug: string, maxItems: number): Promise<void> {
  const states = Object.values((await readIssueStateStore(workspaceDir, projectSlug)).issues);

  for (const state of states.filter((candidate) => candidate.pendingWorkerRelease).slice(0, Math.max(0, maxItems))) {
    await withIssueOrchestrationLock(workspaceDir, projectSlug, state.issueId,
      () => releaseTransitionWorkerLocked(workspaceDir, projectSlug, state.issueId));
  }
}
