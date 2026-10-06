/** Evaluates workspace-wide project exclusivity from fresh registry ownership. */

import { EXECUTION_MODE, type Project, type WorkflowConfig } from "../../domain/index.js";

/** Permit a project pickup only when no different project currently owns a worker.
 * This uses the entire registry, so result is independent of iteration order.
 * @param projectSlug - Project whose queue would dispatch.
 * @param projects - Fresh workspace project registry snapshot.
 * @param mode - Configured project execution mode.
 */
export function mayScheduleProject(projectSlug: string, projects: Readonly<Record<string, Project>>, mode: WorkflowConfig["roleExecution"]): boolean {
  if (mode !== EXECUTION_MODE.SEQUENTIAL) return true;

  return !Object.entries(projects).some(([slug, project]) => slug !== projectSlug
    && Object.values(project.workers).some(worker =>
      Object.values(worker.levels).some(slots => slots?.some(slot => slot.active) ?? false)));
}
