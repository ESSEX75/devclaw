/** Reports and execution contracts shared by heartbeat coordinators. */

import type { RunCommand } from "../../context.js";
import type { IssueRuntimeState, Project, WorkflowConfig, WorkflowPolicyRouting } from "../../domain/index.js";
import type { SessionLookup } from "../../integrations/openclaw/sessions/index.js";
import type { IssueReader } from "../../integrations/providers/index.js";
import type { IssueProvider } from "../../integrations/providers/index.js";
import type { Issue } from "../../integrations/providers/index.js";
import type { ProjectionDiff } from "../../projection/index.js";
import type { ValueOf } from "../../types.js";
import type { NotificationRuntime } from "../notifications/index.js";
import type { ProjectionProvider } from "../projection/index.js";
import type { HEARTBEAT_PASS_FAILURE_POLICY, PROJECTION_INTEGRITY_ACTION } from "./const.js";
import type { HealthFix, HealthIssue } from "./health/types.js";
import type { HeartbeatConfig, ServiceContext } from "./service/types.js";

/** Selects managed issue candidates from local state and fetches their provider context. */
export type HeartbeatCandidateInput = {
  /** Workspace containing the active issue store. */
  workspaceDir: string;
  /** Project whose initialized issues are selected. */
  projectSlug: string;
  /** Local workflow label required of each candidate. */
  workflowLabel: string;
  /** Provider capability used only to observe selected local issues. */
  provider: Pick<IssueReader, "getIssue">;
  /** Saved review or test policy required for this pass. */
  routing?: WorkflowPolicyRouting;
};

/** One locally selected issue paired with its provider observation. */
export type HeartbeatCandidate = {
  /** Fresh provider issue used for context and provider actions. */
  issue: Issue;
  /** Authoritative local state that selected the candidate. */
  localState: IssueRuntimeState;
};

/** Exact local precondition and provider effects for one heartbeat transition. */
export type HeartbeatTransitionInput = {
  /** Workspace containing authoritative issue runtime state. */
  workspaceDir: string;
  /** Project identity and provider routing for the issue. */
  project: Pick<Project, "slug" | "channels" | "provider">;
  /** Managed provider issue identifier. */
  issueId: number;
  /** Provider used for issue reads and projection effects. */
  provider: IssueProvider;
  /** Resolved workflow containing the destination state. */
  workflow: WorkflowConfig;
  /** Local source label that must still match under the issue lock. */
  fromLabel: string;
  /** Destination state key committed to local runtime state. */
  workflowState: string;
  /** Destination label projected after the local commit. */
  workflowLabel: string;
  /** Optional close timestamp for a terminal transition. */
  closedAt?: string | null;
  /** Stable owner recorded by projection and archive effects. */
  owner: string;
  /** Policy-specific provider actions performed after the local recheck. */
  beforeCommit?: () => Promise<void>;
  /** Saved policy that must still match before effects. */
  routing?: WorkflowPolicyRouting;
};

/** One project tick's resolved application and transport dependencies. */
export type HeartbeatRunInput = {
  /** Workspace containing all project stores. */
  workspaceDir: string;
  /** Configured agent whose projects may run. */
  agentId?: string;
  /** Resolved service pickup budget. */
  config: HeartbeatConfig;
  /** Plugin settings including project execution mode. */
  pluginConfig?: Record<string, unknown>;
  /** Gateway session observations, possibly unavailable. */
  sessions: SessionLookup | null;
  /** Project failure logger. */
  logger: Pick<ServiceContext["logger"], "info" | "warn">;
  /** Runtime for exact routed notifications. */
  runtime?: NotificationRuntime;
  /** Provider and gateway command capability. */
  runCommand: RunCommand;
  /** Optional provider capability supplied by a caller already owning an adapter. */
  providerFactory?: (project: Project) => Promise<IssueProvider>;
};

/** A pass operation or a concrete health remedy represented in a report. */
export type HeartbeatAction = {
  /** Operation or remediation identifier. */
  kind: string;
  /** Issue affected by a concrete remedy. */
  issueId?: number | null;
};

/** Observable outcome of one named project pass. */
export type HeartbeatPassReport = {
  /** Stable name of the pass. */
  name: string;
  /** Project whose data was inspected. */
  projectSlug: string;
  /** Diagnostics collected before remediation. */
  findings: HealthIssue[];
  /** Health actions selected by diagnosis. */
  plannedActions: HeartbeatAction[];
  /** Health actions whose remediation completed. */
  appliedActions: HeartbeatAction[];
  /** Failures retained even if a later project continues. */
  errors: string[];
};

/** One sequential pass with an explicit application operation. */
export type HeartbeatPass = {
  /** Name used in diagnostics and errors. */
  name: string;
  /** Application operation, optionally returning detailed health results. */
  run: () => Promise<HealthFix[] | void>;
};

/** Error handling policy for an ordered group of project passes. */
export type HeartbeatPassFailurePolicy = ValueOf<typeof HEARTBEAT_PASS_FAILURE_POLICY>;

/** Aggregated counters and retained pass reports for one heartbeat tick. */
export type HeartbeatTickResult = {
  /** Workers picked up by queue operations. */
  totalPickups: number;
  /** Applied health remedies. */
  totalHealthFixes: number;
  /** Skipped projects and queue candidates. */
  totalSkipped: number;
  /** Successful human review transitions. */
  totalReviewTransitions: number;
  /** Successful review skip transitions. */
  totalReviewSkipTransitions: number;
  /** Successful test skip transitions. */
  totalTestSkipTransitions: number;
  /** Issues archived by recovery. */
  totalArchived: number;
  /** Creations completed by recovery. */
  totalCreationsReady: number;
  /** Creations still awaiting recovery. */
  totalCreationsPending: number;
  /** Creations requiring intervention. */
  totalCreationsManual: number;
  /** Per-project pass outcomes, including failures. */
  passes: HeartbeatPassReport[];
};

/** Provider/metadata observations emitted by heartbeat projection inspection. */
export type ProjectionIntegrityAction = ValueOf<typeof PROJECTION_INTEGRITY_ACTION>;

/** One heartbeat projection observation. */
export type ProjectionIntegrityEvent = {
  /** Inspected provider issue. */
  issueId: number;
  /** Observed or applied action. */
  action: ProjectionIntegrityAction;
  /** Label diff, when reconciliation was required. */
  diff?: ProjectionDiff;
  /** Diagnostics belonging to this observation. */
  errors?: string[];
};

/** Counts and observations from one project projection pass. */
export type ProjectionIntegrityResult = {
  /** Ready managed issues inspected under their locks. */
  checked: number;
  /** Confirmed missing provider issues successfully archived. */
  removed: number;
  /** Issues whose labels required changes. */
  repaired: number;
  /** Failed provider or metadata checks. */
  errors: number;
  /** Closed or not-yet-archivable issues skipped. */
  skipped: number;
  /** Detailed outcomes in inspection order. */
  events: ProjectionIntegrityEvent[];
};

/** Resolved dependencies for heartbeat projection verification. */
export type ProjectionIntegrityInput = {
  /** Workspace containing authoritative issue storage. */
  workspaceDir: string;
  /** Canonical project identity. */
  project: Pick<Project, "slug">;
  /** Provider reads and managed label operations only. */
  provider: ProjectionProvider;
  /** Resolved workflow including custom states. */
  workflow: WorkflowConfig;
  /** Resolved roles allowed in managed labels. */
  roles: string[];
  /** Timestamp used for confirmed provider-missing observations. */
  now?: Date;
};
