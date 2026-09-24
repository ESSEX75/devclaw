/**
 * Records repair lifecycle events with stable issue and correlation identities.
 */
import { log as auditLog } from "../../../audit.js";
import type { IssueRepairResult, RepairManagedIssueInput } from "./types.js";

/** Record one repair checkpoint after its preceding effect. */
export async function auditRepair(
  input: RepairManagedIssueInput,
  event: string,
  correlationId: string,
  result: IssueRepairResult,
): Promise<void> {
  await auditLog(input.workspaceDir, event, {
    projectSlug: input.projectSlug,
    issueId: input.issueId,
    source: input.source,
    actor: input.actor,
    channelContext: input.channelContext,
    correlationId,
    reason: input.reason,
    missingManagedLabels: result.diffBefore.missingManagedLabels,
    unexpectedManagedLabels: result.diffBefore.unexpectedManagedLabels,
    localChanges: result.localChanges.map((change) => change.field),
  });
}
