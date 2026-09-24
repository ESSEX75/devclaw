/**
 * Defines inputs and results for the durable managed-task creation capability.
 */
import type { IssueProviderId, NotifyBindingRef, Project, WorkflowConfig } from "../../../domain/index.js";
import type { Issue, IssueReader, IssueWriter, LabelProjector, ProviderRateLimitReader } from "../../../integrations/providers/index.js";
import type { IssueCreationFailure } from "../../../state/index.js";

/** Provider operations required by creation, projection read-back, and quota preflight. */
export type CreationProvider = Pick<IssueReader, "getIssue">
  & Pick<IssueWriter, "createIssue" | "editIssue">
  & Pick<LabelProjector, "ensureLabel" | "addLabel" | "removeLabels">
  & ProviderRateLimitReader;

/** Structured task creation result that never reports an incomplete provider issue as successful. */
export type CreatedManagedTask = {
  /** True only after the durable operation reaches ready. */
  success: boolean;
  /** Caller-facing recovery category. */
  status: "ready" | "pending" | "failed" | "manual_repair_required";
  /** Durable creation operation identity. */
  operationId: string;
  /** Caller-supplied deduplication key. */
  idempotencyKey: string;
  /** Canonical owning project slug. */
  project: string;
  /** Provider issue identity when known, even if creation is incomplete. */
  issue?: Issue;
  /** Intended provider workflow label. */
  label: string;
  /** Intended canonical workflow state. */
  workflowState: string;
  /** Assigned role selected at creation. */
  role: string | null;
  /** Checkpoints already persisted. */
  completedSteps: string[];
  /** Checkpoints remaining before readiness. */
  pendingSteps: string[];
  /** Integrity of the published runtime state. */
  integrity: "ok" | "pending" | "error";
  /** Last durable failure, when present. */
  error?: IssueCreationFailure;
  /** Recovery instructions derived from durable state. */
  recovery?: {
    /** Whether heartbeat may retry safely. */
    automatic: boolean;
    /** Earliest provider retry time. */
    nextAttemptAt?: string;
    /** Operator guidance when a provider issue exists. */
    repairHint?: string;
  };
  /** Shared identifier for creation audit events. */
  auditCorrelationId: string;
  /** Caller-facing status text appended to the announcement. */
  announcementSuffix: string;
};

/** Input required to start or idempotently resume one managed issue creation. */
export type CreateManagedTaskInput = {
  /** Workspace containing project and issue stores. */
  workspaceDir: string;
  /** Canonical project and notification routes. */
  project: Pick<Project, "slug" | "channels">;
  /** Provider selected by resolved project configuration. */
  providerType: IssueProviderId;
  /** Provider used for mutation and read-back. */
  provider: CreationProvider;
  /** Resolved workflow for initial state validation. */
  workflow: WorkflowConfig;
  /** Configured role IDs used to project labels. */
  roles?: string[];
  /** Requested provider issue title. */
  title: string;
  /** Requested provider issue body. */
  description: string;
  /** Provider usernames assigned at creation. */
  assignees?: string[];
  /** Exact notification endpoint binding. */
  notifyTarget?: NotifyBindingRef | null;
  /** DevClaw instance owner. */
  owner?: string | null;
  /** Stable key that deduplicates retries. */
  idempotencyKey: string;
  /** Actor recorded in the initial operation. */
  requestedBy: string;
  /** Optional configured initial workflow state. */
  workflowState?: string;
  /** Optional role override for the initial state. */
  assignedRole?: string | null;
  /** Optional level override for the initial state. */
  assignedLevel?: string | null;
};
/** Inputs for a bounded heartbeat reconciliation pass. */
export type ReconcileManagedTaskCreationsInput = Pick<
  CreateManagedTaskInput,
  "workspaceDir" | "project" | "providerType" | "provider" | "workflow" | "roles"
> & {
  /** Maximum number of unfinished operations inspected in this pass. */
  maxItems: number;
};

/** Outcome of a bounded reconciliation pass. */
export type ReconcileManagedTaskCreationsResult = {
  /** Provider issue IDs whose creation became ready. */
  ready: number[];
  /** Operation IDs still pending automatic recovery. */
  pending: string[];
  /** Operation IDs requiring manual repair. */
  manual: string[];
};
