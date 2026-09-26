/** Executes project passes in order while retaining partial results and failure details. */
import type { HeartbeatPass, HeartbeatPassReport } from "./types.js";

/** Run sequential passes, stopping this project on the first failed prerequisite.
 * Previously completed results are retained; the tick coordinator can continue other projects.
 * @param projectSlug - Project recorded in every pass report.
 * @param passes - Ordered application operations for the project.
 * @param reports - Caller-owned output retaining successes and the failing pass.
 */
export async function runHeartbeatPasses(projectSlug: string, passes: readonly HeartbeatPass[], reports: HeartbeatPassReport[]): Promise<boolean> {
  for (const pass of passes) {
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

    if (report.errors.length > 0) return false;
  }

  return true;
}
