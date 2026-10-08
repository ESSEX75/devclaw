/**
 * Defines application contracts for runtime initialization, authoritative updates, and read-only resolution.
 */

import type {
  ActiveIssueWorker, IssueIntegrityStatus, IssueProviderId, IssueRuntimeState, NotifyBindingRef,
  Project, ReviewPolicy, TestPolicy, WorkflowConfig, WorkflowStateConfig,
} from "../../domain/index.js";
import type { Issue } from "../../integrations/index.js";
import type { ResolvedConfig } from "../../state/index.js";
import type { ISSUE_RUNTIME_KIND } from "./const.js";

/** Validated lifecycle choices preserved in an initial runtime record. */
export type InitialIssueRuntimeInput = Pick<
  IssueRuntimeState,
  | "provider"
  | "workflowState"
  | "workflowLabel"
  | "assignedRole"
  | "assignedLevel"
  | "owner"
  | "reviewPolicy"
  | "testPolicy"
  | "notifyTarget"
>;

/** Application input combining provider projection with explicit lifecycle changes. */
export type IssueStateWriteInput = {
  /** Workspace containing authoritative local state. */
  workspaceDir: string;
  /** Project that owns the provider issue. */
  project: Pick<Project, "slug" | "channels">;
  /** Provider projection used only for explicit initialization. */
  issue: IssueProjectionSnapshot;
  /** Provider selected by project configuration. */
  providerType: IssueProviderId;
  /** Durable creation saga identifier. */
  creationOperationId?: string;
  /** Resolved workflow used to interpret initialization labels. */
  workflow: WorkflowConfig;
  /** Resolved roles permitting projection import on initialization; absent means no inferred assignment. */
  initializationRoles?: ResolvedConfig["roles"];
  /** Explicit provider-facing workflow label. */
  workflowLabel?: string;
  /** Explicit canonical workflow state. */
  workflowState?: string;
  /** Explicit assigned role replacement. */
  assignedRole?: string | null;
  /** Explicit assigned level replacement. */
  assignedLevel?: string | null;
  /** Explicit DevClaw owner replacement. */
  owner?: string | null;
  /** Explicit notification binding replacement. */
  notifyTarget?: NotifyBindingRef | null;
  /** Explicit review policy replacement. */
  reviewPolicy?: ReviewPolicy | null;
  /** Explicit test policy replacement. */
  testPolicy?: TestPolicy | null;
  /** Explicit active worker replacement. */
  activeWorker?: ActiveIssueWorker | null;
  /** Worker release intent persisted with the workflow transition. */
  pendingWorkerRelease?: ActiveIssueWorker | null;
  /** Terminal delivery intent persisted with the workflow transition. */
  pipelineNotification?: IssueRuntimeState["pipelineNotification"];
  /** Explicit integrity status replacement. */
  integrityStatus?: IssueIntegrityStatus;
  /** Explicit closure timestamp replacement. */
  closedAt?: string | null;
};

/** Provider identity and labels used for initialization or an uninitialized observation. */
export type IssueProjectionSnapshot = Pick<Issue, "iid" | "labels">;

/** Authoritative runtime state and its matching current workflow configuration. */
type ManagedIssueRuntimeResolution = {
  /** Indicates that local runtime state is authoritative. */
  kind: typeof ISSUE_RUNTIME_KIND.MANAGED;
  /** Authoritative local runtime state. */
  state: IssueRuntimeState;
  /** Workflow label recorded in local state. */
  workflowLabel: string;
  /** Workflow state key recorded in local state. */
  workflowState: string;
  /** Configuration matching both the recorded state key and label, or null on configuration drift. */
  stateConfig: WorkflowStateConfig | null;
};

/** Provider projection observed without creating an authoritative record. */
type UninitializedIssueRuntimeResolution = {
  /** Indicates that no authoritative local runtime state exists yet. */
  kind: typeof ISSUE_RUNTIME_KIND.UNINITIALIZED;
  /** Confirms the absence of authoritative local runtime state. */
  state: null;
  /** Provider-visible workflow label interpreted as projection data. */
  workflowLabel: string | null;
  /** Workflow state key inferred from the provider projection. */
  workflowState: string | null;
  /** Current workflow configuration inferred from the provider projection. */
  stateConfig: WorkflowStateConfig | null;
};

/** Distinguishes authoritative runtime state from an uninitialized projection. */
export type IssueRuntimeResolution = ManagedIssueRuntimeResolution | UninitializedIssueRuntimeResolution;

/** Inputs for read-only managed-state resolution. */
export type IssueRuntimeResolveInput = {
  /** Workspace containing the active issue store. */
  workspaceDir: string;
  /** Canonical project identity used to address the store. */
  project: Pick<Project, "slug">;
  /** Provider labels used only when no local record exists. */
  issue: IssueProjectionSnapshot;
  /** Current workflow used to inspect persisted state or an uninitialized projection. */
  workflow: WorkflowConfig;
};
