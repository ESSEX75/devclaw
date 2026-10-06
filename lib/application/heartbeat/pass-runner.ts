/** Executes project passes in order while retaining partial results and failure details. */

import { HEARTBEAT_PASS_FAILURE_POLICY } from "./const.js";
import type { HeartbeatPass, HeartbeatPassFailurePolicy, HeartbeatPassReport } from "./types.js";

/** Run project passes in order, retaining every attempted report and applying the selected failure policy.
 * @param projectSlug - Project recorded in every pass report.
 * @param passes - Ordered operations for the project.
 * @param reports - Caller-owned output retaining each attempted pass.
 * @param failurePolicy - Whether an error stops this group or allows later passes to run.
 */
export async function runHeartbeatPasses(
  projectSlug: string,
  passes: readonly HeartbeatPass[],
  reports: HeartbeatPassReport[],
  failurePolicy: HeartbeatPassFailurePolicy = HEARTBEAT_PASS_FAILURE_POLICY.STOP,
): Promise<boolean> {
  let completed = true;

  for (const pass of passes) {
    if (await runHeartbeatPass(projectSlug, pass, reports)) continue;
    completed = false;
    if (failurePolicy === HEARTBEAT_PASS_FAILURE_POLICY.STOP) break;
  }

  return completed;
}

/** Execute one pass and retain its actions, findings, and errors.
 * @param projectSlug - Project recorded in the pass report.
 * @param pass - Application operation to execute.
 * @param reports - Caller-owned output receiving this pass report.
 */
async function runHeartbeatPass(projectSlug: string, pass: HeartbeatPass, reports: HeartbeatPassReport[]): Promise<boolean> {
  const report: HeartbeatPassReport = { name: pass.name, projectSlug, findings: [], plannedActions: [{ kind: pass.name }], appliedActions: [], errors: [] };

  reports.push(report);
  try {
    const fixes = await pass.run();

    if (fixes) {
      report.findings = fixes.map((fix) => fix.issue);
      report.plannedActions = fixes.flatMap((fix) => fix.plannedAction ? [{ kind: fix.plannedAction, issueId: fix.issue.issueId }] : []);
      report.appliedActions = fixes.filter((fix) => fix.fixed || fix.appliedAction).map((fix) => ({
        kind: fix.appliedAction ?? fix.plannedAction ?? fix.issue.type,
        issueId: fix.issue.issueId,
      }));
      report.errors = fixes.flatMap((fix) => fix.error ? [fix.error] : []);
    } else report.appliedActions.push({ kind: pass.name });
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  }

  return report.errors.length === 0;
}
