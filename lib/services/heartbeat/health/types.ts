import type { Role } from "../../../workflow/types.js";

/** Grace period: skip session-dead checks for workers started within this window. */
export const GRACE_PERIOD_MS = 5 * 60 * 1_000; // 5 minutes

/** Context token threshold below which we assume the task message never arrived. */
export const STALL_CONTEXT_THRESHOLD = 1_000;

/** Message sent to nudge a stalled session back to life. */
export const NUDGE_MESSAGE = `You appear to have stalled. Continue working on your current task. If you are blocked or unable to proceed, call work_finish with result "blocked".`;

export type HealthIssue = {
  type:
    | "session_dead"
    | "label_mismatch"
    | "stale_worker"
    | "stuck_label"
    | "orphan_issue_id"
    | "issue_gone"
    | "issue_closed"
    | "orphaned_label"
    | "context_overflow"
    | "session_stalled"
    | "stateless_issue";
  severity: "critical" | "warning";
  project: string;
  projectSlug: string;
  role: Role;
  message: string;
  level?: string | null;
  sessionKey?: string | null;
  hoursActive?: number;
  issueId?: string | null;
  expectedLabel?: string;
  actualLabel?: string | null;
  slotIndex?: number;
};

export type HealthFix = {
  issue: HealthIssue;
  fixed: boolean;
  labelReverted?: string;
  labelRevertFailed?: boolean;
  nudgeSent?: boolean;
};
