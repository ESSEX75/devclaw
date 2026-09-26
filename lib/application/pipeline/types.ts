/** Contracts for planned pipeline transitions and completion responses. */
import type { CompletionRule, Project, TransitionAction, WorkflowConfig } from "../../domain/index.js";
import type { Issue, IssueProvider } from "../../integrations/providers/provider.js";

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

/** Review provider outcome that selects a workflow transition or no-op. */
export type ReviewOutcome =
  | { kind: "approved" }
  | { kind: "changes_requested" }
  | { kind: "conflict" }
  | { kind: "closed_unmerged" }
  | { kind: "missing_pr" }
  | { kind: "pending" }
  | { kind: "merge_failed"; error: string };

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
  routing?: {
    /** Local field used to select this pass. */
    field: "reviewPolicy" | "testPolicy";
    /** Expected policy value from candidate selection. */
    value: "human" | "agent" | "skip";
  };
  /** Policy-specific provider actions performed only after the state check. */
  beforeCommit?: () => Promise<void>;
  /** Provider lifecycle actions performed after the visible label transition. */
  afterLabel?: () => Promise<void>;
  /** Archive terminal state after its durable notification is handled. */
  archiveTerminal?: boolean;
};
