/** Queries task contracts, shared by the owning capability. */

import type { IssueRuntimeState, WorkerDeliveryState, WorkflowConfig } from "../../../domain/index.js";
import type { IssueReader } from "../../../integrations/providers/index.js";
import type { IssueCreationFailure, IssueCreationOperation } from "../../../state/index.js";

/** Issues grouped under one configured state label. */
type StateBucket = Record<string, StateGroup>;

/** Issues visible under one workflow state. */
type StateGroup = {
  /** Number of issues represented by this bucket. */
  count: number;
  /** Task summaries belonging to the selected workflow state. */
  issues: TaskIssueSummary[];
};

/** Configured HOLD state with its operator guidance. */
type HoldStateLabel = {
  /** Provider-visible workflow label selected by configuration. */
  label: string;
  /** Operator guidance for this state. */
  hint: string;
};

/** Configured active state and its responsible role. */
type ActiveStateLabel = {
  /** Provider-visible workflow label selected by configuration. */
  label: string;
  /** Configured role responsible for the workflow state or worker task. */
  role?: string;
};

/** Configured queue state with its scheduling priority. */
type QueueStateLabel = ActiveStateLabel & {
  /** Configured queue ordering priority. */
  priority?: number;
};

/** Unfinished durable creation shown to operators. */
type CreationSummary = {
  /** Durable creation identity used for recovery. */
  operationId: string;
  /** Immutable title requested by the creation operation. */
  title: string;
  /** Persisted creation phase. */
  status: IssueCreationOperation["status"];
  /** Provider-local issue identifier. */
  issueId?: number;
  /** Last durable creation failure and retry guidance. */
  error?: IssueCreationFailure;
};

/** Configured labels grouped by workflow semantics. */
type StatusLabels = {
  /** States or task groups waiting for explicit approval. */
  hold: HoldStateLabel[];
  /** States or task groups assigned to active work. */
  active: ActiveStateLabel[];
  /** States or task groups eligible for worker pickup. */
  queue: QueueStateLabel[];
};

/** Aggregate counts of ready open tasks. */
type StatusTotals = {
  /** Number of ready open tasks waiting for approval. */
  totalHold: number;
  /** Number of ready open tasks in active states. */
  totalActive: number;
  /** Number of ready open tasks awaiting pickup. */
  totalQueued: number;
};

/** Creation operations separated by automatic recovery eligibility. */
type CreationGroups = {
  /** Creation operations eligible for continued recovery. */
  pending: CreationSummary[];
  /** Creation operations requiring an operator decision. */
  failed: CreationSummary[];
};

/** Applied task list filters echoed to callers. */
type TaskListFilter = {
  /** Optional workflow classification filter. */
  stateType: string | null;
  /** Provider-visible workflow label selected by configuration. */
  label: string | null;
  /** Optional case-insensitive title substring filter. */
  search: string | null;
};

/** Authoritative assignment displayed alongside provider labels. */
type LocalTaskState = Pick<IssueRuntimeState, "workflowState" | "workflowLabel">
  & Partial<Pick<IssueRuntimeState, "assignedRole" | "assignedLevel">>;

/** Ready task counts plus unfinished creation diagnostics. */
export type TaskStatusResult = {
  /** Configured workflow labels grouped by semantics. */
  stateLabels: StatusLabels;
  /** Aggregate counts across the displayed ready tasks. */
  summary: StatusTotals;
  /** States or task groups waiting for explicit approval. */
  hold: StateBucket;
  /** States or task groups assigned to active work. */
  active: StateBucket;
  /** States or task groups eligible for worker pickup. */
  queue: StateBucket;
  /** Unfinished creation operations shown separately from ready tasks. */
  creation: CreationGroups;
};

/** Limited task summaries for one configured workflow state. */
export type TaskListStateGroup = {
  /** Provider-visible workflow label selected by configuration. */
  label: string;
  /** Configured workflow state classification. */
  type: string;
  /** Configured role responsible for the workflow state or worker task. */
  role?: string;
  /** Task summaries belonging to the selected workflow state. */
  issues: TaskIssueSummary[];
  /** Number of matching issues before the per-state limit. */
  total: number;
};

/** Read-only task listing with applied filters and untruncated totals. */
export type TaskListResult = {
  /** Filters applied to the listing. */
  filter: TaskListFilter;
  /** Authoritative issue snapshots or result groups keyed by workflow state. */
  states: TaskListStateGroup[];
  /** Number of matching issues across all selected states. */
  totalIssues: number;
};

/** Provider observations compared with authoritative runtime state. */
export type TaskIssueProjectionView = {
  /** Observed provider labels, which do not override local state. */
  providerLabels: string[];
  /** Authoritative assignment, or null for an uninitialized issue. */
  localState: LocalTaskState | null;
  /** Persisted integrity classification for operator diagnosis. */
  integrityStatus: IssueRuntimeState["integrityStatus"];
  /** Expected managed labels absent from the provider snapshot. */
  missingManagedLabels: string[];
  /** Managed provider labels inconsistent with authoritative state. */
  unexpectedManagedLabels: string[];
  /** Provider labels outside DevClaw ownership. */
  unmanagedLabels: string[];
  /** Suggested explicit repair command when projection is inconsistent. */
  repairHint: string | null;
  /** Unconfirmed worker delivery requiring inspection before another dispatch. */
  workerDelivery?: WorkerDeliveryState;
  /** Terminal notification evidence, including blocked and unknown reasons. */
  pipelineNotification?: NonNullable<IssueRuntimeState["pipelineNotification"]>;
  /** Operator guidance for a delivery that cannot be resolved from gateway evidence. */
  deliveryHint?: string;
};

/** Provider issue identity enriched with local-state diagnostics. */
export type TaskIssueSummary = {
  /** Provider-local issue identifier. */
  id: number;
  /** Requested title, omitted to retain current provider content. */
  title: string;
  /** Provider issue URL for operator navigation. */
  url: string;
  /** Comparison of local truth with provider-visible labels. */
  projection: TaskIssueProjectionView;
};

/** Shared runtime snapshot and configuration used to render projection views. */
export type ProjectionViewContext = {
  /** Authoritative issue snapshots or result groups keyed by workflow state. */
  states: Record<string, IssueRuntimeState>;
  /** Effective project workflow including custom states. */
  workflow: WorkflowConfig;
  /** Effective role identifiers or resolved role configurations. */
  roles: string[];
};

/** Inputs consumed by getManagedTaskStatus after adapter validation. */
export type GetManagedTaskStatusInput = {
  /** Configured workspace containing authoritative project state. */
  workspaceDir: string;
  /** Canonical project identifier addressing local state. */
  projectSlug: string;
  /** Effective project workflow including custom states. */
  workflow: WorkflowConfig;
  /** Effective role identifiers or resolved role configurations. */
  roles: string[];
  /** Provider capability or identifier used for this operation. */
  provider: Pick<IssueReader, "getIssue">;
};

/** Inputs consumed by listManagedTasks after adapter validation. */
export type ListManagedTasksInput = {
  /** Configured workspace containing authoritative project state. */
  workspaceDir: string;
  /** Canonical project identifier addressing local state. */
  projectSlug: string;
  /** Effective project workflow including custom states. */
  workflow: WorkflowConfig;
  /** Effective role identifiers or resolved role configurations. */
  roles: string[];
  /** Provider capability or identifier used for this operation. */
  provider: Pick<IssueReader, "getIssue">;
  /** Optional workflow classification filter. */
  stateType?: string;
  /** Provider-visible workflow label selected by configuration. */
  label?: string;
  /** Optional case-insensitive title substring filter. */
  search?: string;
  /** Maximum summaries per state; defaults to the task query policy. */
  limit?: number;
};

/** Inputs consumed by loadProjectionViewContext after adapter validation. */
export type LoadProjectionViewContextInput = {
  /** Configured workspace containing authoritative project state. */
  workspaceDir: string;
  /** Canonical project identifier addressing local state. */
  projectSlug: string;
  /** Effective project workflow including custom states. */
  workflow: WorkflowConfig;
  /** Effective role identifiers or resolved role configurations. */
  roles: string[];
};
