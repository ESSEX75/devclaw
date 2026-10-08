/** Contracts for planned pipeline transitions and completion responses. */

import type { RunCommand } from "../../context.js";
import type {
  ActiveIssueWorker, CompletionRule, IssueRuntimeState, NotificationEndpoint, Project, TransitionAction, WorkflowConfig, WorkflowPolicyRouting,
} from "../../domain/index.js";
import type { Issue, IssueProvider } from "../../integrations/providers/contracts/index.js";
import type { NotificationCreatedTask, NotificationRuntime } from "../notifications/index.js";

/** A validated workflow transition with its provider actions. */
export type TransitionPlan = {
  /** Source state label expected before any provider effect. */
  from: string;
  /** Resolved destination state key. */
  toState: string;
  /** Resolved destination label. */
  toLabel: string;
  /** Actions selected by the configured workflow event. */
  actions: readonly TransitionAction[];
};

/** Planned agent completion, including its configured result description. */
export type CompletionPlan = {
  /** Configured completion event for the role result. */
  event: string;
  /** Rule selected from the resolved workflow. */
  rule: CompletionRule<string>;
  /** State transition selected by that rule. */
  transition: TransitionPlan;
  /** Description used by the completion announcement. */
  nextState: string;
};

/** User-facing result of a completed agent transition. */
export type CompletionOutput = {
  /** Provider-visible label change. */
  labelTransition: string;
  /** Human-readable completion summary. */
  announcement: string;
  /** Description or label of the destination state. */
  nextState: string;
  /** URL of the detected or supplied pull request. */
  prUrl?: string;
  /** URL of the completed issue. */
  issueUrl?: string;
  /** Whether the issue was closed during completion. */
  issueClosed?: boolean;
  /** Whether the issue was reopened during completion. */
  issueReopened?: boolean;
};

/** Arguments for a transition while its caller holds the issue lock. */
export type CommitTransitionInput = {
  /** Workspace containing the authoritative issue record. */
  workspaceDir: string;
  /** Project whose issue is transitioning. */
  project: Pick<Project, "slug" | "channels" | "provider">;
  /** Managed provider issue identifier. */
  issueId: number;
  /** Provider adapter used for visible effects. */
  provider: IssueProvider;
  /** Resolved workflow used for state and projection. */
  workflow: WorkflowConfig;
  /** Validated transition selected before effects. */
  plan: TransitionPlan;
  /** Owner recorded in projection and archive operations. */
  owner: string;
  /** Provider snapshot fetched before the transition. */
  issue: Issue;
  /** Optional close time for a successful close action. */
  closedAt?: string | null;
  /** Role identifiers required to project custom role labels. */
  roles?: string[];
  /** Reject a stale local state instead of repeating provider effects. */
  checkLocalState?: boolean;
  /** Routing policy that must still match before heartbeat actions run. */
  routing?: WorkflowPolicyRouting;
  /** Policy-specific provider actions performed only after the state check. */
  beforeCommit?: () => Promise<void>;
  /** Provider lifecycle actions performed after the visible label transition. */
  afterLabel?: () => Promise<void>;
  /** Archive terminal state after its durable notification is handled. */
  archiveTerminal?: boolean;
};

/** Validated completion command and the capabilities needed to execute it. */
export type CompletionInput = {
  /** Exact worker observed by finish-work, rechecked before provider effects. */
  expectedWorker?: ActiveIssueWorker;
  /** Workspace containing authoritative state. */
  workspaceDir: string;
  /** Canonical project identity. */
  projectSlug: string;
  /** Configured completing role. */
  role: string;
  /** Configured completion result. */
  result: string;
  /** Managed provider issue identifier. */
  issueId: number;
  /** Worker-provided completion summary. */
  summary?: string;
  /** Previously observed pull request URL. */
  prUrl?: string;
  /** Provider for workflow effects. */
  provider: IssueProvider;
  /** Resolved checkout for git actions. */
  repoPath: string;
  /** Display name used in announcements. */
  projectName: string;
  /** Configured project notification endpoints. */
  channels: NotificationEndpoint[];
  /** Plugin notification policy. */
  pluginConfig?: Record<string, unknown>;
  /** Plugin runtime for direct API access (avoids CLI subprocess timeouts) */
  runtime?: NotificationRuntime;
  /** Workflow config (defaults to DEFAULT_WORKFLOW) */
  workflow?: WorkflowConfig;
  /** Tasks created during this work session (e.g. architect implementation tasks) */
  createdTasks?: NotificationCreatedTask[];
  /** Level of the completing worker */
  level?: string;
  /** Slot index within the level's array */
  slotIndex?: number;
  /** Command execution capability. */
  runCommand: RunCommand;
};

/** Observations from completion provider actions, retained for rendering. */
export type CompletionActions = {
  /** Resolved pull request URL. */
  prUrl?: string;
  /** Whether the provider confirmed a merged PR. */
  mergedPr: boolean;
  /** Provider PR title. */
  prTitle?: string;
  /** Branch associated with the PR. */
  sourceBranch?: string;
  /** Confirmed merge failure requiring the configured recovery transition. */
  mergeFailure: CompletionMergeFailure | null;
};

/** Committed completion context passed to notification orchestration. */
export type CompletionNotificationInput = {
  /** Original command and delivery capabilities. */
  opts: CompletionInput;
  /** Owning project and exact routes. */
  project: Project;
  /** Issue context observed before effects. */
  issue: Issue;
  /** Committed authoritative runtime state. */
  runtimeState: IssueRuntimeState;
  /** Selected completion semantics. */
  plan: CompletionPlan;
  /** Provider observations used in event payloads. */
  actions: CompletionActions;
  /** Optional display name of the completing worker. */
  workerName?: string;
  /** Auxiliary events are emitted only on the initial completion attempt. */
  notifyAuxiliary: boolean;
};

/** Confirmed inability to merge, distinct from an uncertain provider response. */
type CompletionMergeFailure = {
  /** Provider failure diagnostic. */
  error: string;
};
