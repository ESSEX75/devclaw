/**
 * issues_cleanup — Archive closed local issue state into inline archive.issues.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import { log as auditLog } from "../../audit.js";
import { ISSUE_INTEGRITY_STATUS, WORKFLOW_STATE_KEYS } from "../../domain/index.js";
import { updateIssueStateStore } from "../../state/issues/index.js";
import { requireWorkspaceDir } from "../helpers.js";

export type IssuesCleanupResult = {
  projectSlug: string;
  archived: number[];
  skipped: Array<{ issueId: number; reason: string }>;
};

const ARCHIVABLE_TERMINAL_STATES: Set<string> = new Set([WORKFLOW_STATE_KEYS.DONE, WORKFLOW_STATE_KEYS.REJECTED]);

function parseRetention(value: string): number {
  const match = /^(\d+)([dh])$/.exec(value);

  if (!match) throw new Error(`Invalid retention "${value}". Use formats like 30d or 12h.`);
  const amount = Number(match[1]);
  const unit = match[2];

  return amount * (unit === "d" ? 86_400_000 : 3_600_000);
}

export async function cleanupIssueState(opts: {
  workspaceDir: string;
  projectSlug: string;
  olderThan: string;
}): Promise<IssuesCleanupResult> {
  const retentionMs = parseRetention(opts.olderThan);
  const cutoff = Date.now() - retentionMs;
  const archived: number[] = [];
  const skipped: Array<{ issueId: number; reason: string }> = [];

  await updateIssueStateStore(opts.workspaceDir, opts.projectSlug, (store) => {
    for (const [key, issue] of Object.entries(store.issues)) {
      if (!issue.closedAt) {
        skipped.push({ issueId: issue.issueId, reason: "not closed" });
        continue;
      }

      if (!ARCHIVABLE_TERMINAL_STATES.has(issue.workflowState)) {
        skipped.push({ issueId: issue.issueId, reason: "non-terminal state" });
        continue;
      }

      if (Date.parse(issue.closedAt) > cutoff) {
        skipped.push({ issueId: issue.issueId, reason: "within retention window" });
        continue;
      }

      if (issue.integrityStatus === ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR) {
        skipped.push({ issueId: issue.issueId, reason: ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR });
        continue;
      }

      if (issue.activeWorker) {
        skipped.push({ issueId: issue.issueId, reason: "active worker" });
        continue;
      }


      const archivedAt = new Date().toISOString();

      store.archive.issues[key] = {
        issueId: issue.issueId,
        finalWorkflowState: issue.workflowState,
        closedAt: issue.closedAt,
        archivedAt,
        lastIntegrityStatus: issue.integrityStatus,
      };
      delete store.issues[key];
      archived.push(issue.issueId);
    }
  });

  if (archived.length > 0) {
    await auditLog(opts.workspaceDir, "issue_state_cleanup", {
      project: opts.projectSlug,
      archived,
    });
  }

  return { projectSlug: opts.projectSlug, archived, skipped };
}

export function createIssuesCleanupTool() {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "issues_cleanup",
    label: "Issues Cleanup",
    description: "Archive old terminal closed project-local issue states into inline archive.issues.",
    parameters: {
      type: "object",
      required: ["project", "olderThan"],
      properties: {
        project: { type: "string", description: "Project slug." },
        olderThan: { type: "string", description: "Retention window, e.g. 30d or 12h." },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const result = await cleanupIssueState({
        workspaceDir: requireWorkspaceDir(toolCtx),
        projectSlug: params.project as string,
        olderThan: params.olderThan as string,
      });

      return jsonResult({ success: true, ...result });
    },
  });
}
