/** Findings and explicit action contracts for heartbeat health inspection. */
import type { RunCommand } from "../../../context.js";
import type { Project, WorkflowConfig } from "../../../domain/index.js";
import type { IssueProvider } from "../../../integrations/providers/provider.js";
import type { ValueOf } from "../../../types.js";
import type { HEALTH_ACTION } from "./const.js";
import type { SessionLookup } from "./gateway-sessions.js";

/** Dependencies for read-only diagnosis and explicit worker remediation. */
export type WorkerHealthInput = {
  /** Workspace containing worker and issue state. */
  workspaceDir: string;
  /** Canonical project key. */
  projectSlug: string;
  /** Project snapshot used for diagnosis. */
  project: Project;
  /** Configured worker role. */
  role: string;
  /** Provider used for fresh issue observations. */
  provider: IssueProvider;
  /** Gateway observation for this pass, or null when unavailable. */
  sessions: SessionLookup | null;
  /** Validated workflow, defaulting to the built-in workflow. */
  workflow?: WorkflowConfig;
  /** Age at which a worker is considered stale. */
  staleWorkerHours?: number;
  /** Inactivity threshold used for stalled sessions. */
  stallTimeoutMinutes?: number;
  /** Command capability used only by remediation. */
  runCommand: RunCommand;
  /** Agent receiving worker nudges. */
  agentId?: string;
};

/** Remediation selected by diagnosis, never executed during diagnosis. */
export type HealthAction = ValueOf<typeof HEALTH_ACTION>;

/** One diagnosed worker or provider projection condition. */
export type HealthIssue = {
  /** Condition used to select remediation. */
  type:
    | "session_dead"
    | "inspection_failed"
    | "label_mismatch"
    | "stale_worker"
    | "stuck_label"
    | "orphan_issue_id"
    | "issue_gone"
    | "issue_closed"
    | "orphaned_label"
    | "context_overflow"
    | "session_stalled"
    | "stateless_issue"
    | "delivery_unknown";
  severity: "critical" | "warning";
  /** Project display name. */
  project: string;
  /** Stable project key. */
  projectSlug: string;
  /** Configured role, or empty for a project-wide inspection failure. */
  role: string;
  /** Human-readable diagnostic context. */
  message: string;
  /** Level containing the diagnosed slot. */
  level?: string | null;
  /** Session observed during diagnosis. */
  sessionKey?: string | null;
  /** Observed worker age in hours. */
  hoursActive?: number;
  /** Provider-local issue identity. */
  issueId?: number | null;
  /** Workflow label expected from local state. */
  expectedLabel?: string;
  /** Provider label seen in the diagnostic snapshot. */
  actualLabel?: string | null;
  /** Exact slot within the level. */
  slotIndex?: number;
};

/** Diagnosis plus proposed and actually executed remediation. */
export type HealthFix = {
  /** Condition observed before remediation. */
  issue: HealthIssue;
  /** Whether the remedy completed; a submitted nudge does not confirm worker progress. */
  fixed: boolean;
  /** Visible workflow label change when recovery completed. */
  labelReverted?: string;
  /** Whether a requested workflow restoration failed. */
  labelRevertFailed?: boolean;
  /** Whether a nudge was submitted, without claiming delivery confirmation. */
  nudgeSent?: boolean;
  /** Explicit action proposed by read-only diagnosis. */
  plannedAction?: HealthAction;
  /** Action executed even when the underlying finding remains unresolved. */
  appliedAction?: HealthAction;
  /** Failure observed while applying the action, if any. */
  error?: string;
};
