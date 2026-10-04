/** Checks project worker reservations for managed issue administration. */

import { findSlotByIssue, type Project } from "../../domain/index.js";

/** Return whether any project role still reserves a slot for the issue.
 * @param project - Fresh or explicitly captured project registry state.
 * @param issueId - Provider-local issue whose reservation is checked.
 */
export function hasProjectWorkerSlot(project: Project, issueId: number): boolean {
  return Object.values(project.workers).some((worker) => findSlotByIssue(worker, issueId) !== null);
}
