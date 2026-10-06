/** Archives terminal pipeline issues after their notification intent is resolved. */

import { ISSUE_ARCHIVE_REASON, type WorkflowConfig } from "../../domain/index.js";
import type { Issue } from "../../integrations/providers/provider.js";
import { ARCHIVE_BLOCK_REASON, archiveManagedIssueLocked } from "../issues/index.js";
import { PIPELINE_TERMINAL_ARCHIVE_CORRELATION_PREFIX } from "./const.js";

/** Context shared by completion and heartbeat terminal archive attempts. */
type TerminalArchiveInput = {
  /** Workspace containing the authoritative issue state. */
  workspaceDir: string;
  /** Canonical project containing the issue. */
  projectSlug: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Resolved workflow used to validate the terminal state. */
  workflow: WorkflowConfig;
  /** Provider snapshot retained only as archive display context. */
  issue: Issue;
  /** Operation owner recorded with the archive. */
  actor: string;
  /** Committed terminal workflow key. */
  workflowState: string;
};

/**
 * Archive a terminal issue while accepting pending notification delivery as a deferred result.
 * The caller holds the issue orchestration lock; other archive refusals remain errors.
 *
 * @param input - Committed issue state and archive operation context.
 */
export async function archiveTerminalIssueLocked(input: TerminalArchiveInput): Promise<void> {
  const archived = await archiveManagedIssueLocked({
    workspaceDir: input.workspaceDir,
    projectSlug: input.projectSlug,
    issueId: input.issueId,
    archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL,
    workflow: input.workflow,
    snapshot: { title: input.issue.title, issueUrl: input.issue.web_url },
    actor: input.actor,
    correlationId: `${PIPELINE_TERMINAL_ARCHIVE_CORRELATION_PREFIX}${input.projectSlug}:${input.issueId}:${input.workflowState}`,
  });

  if (!archived.archived && archived.reason !== ARCHIVE_BLOCK_REASON.NOTIFICATION_PENDING) {
    throw new Error(`Terminal issue #${input.issueId} could not be archived: ${archived.reason ?? "unknown"}.`);
  }
}
