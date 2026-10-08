/**
 * Defines repair command inputs, snapshots, plans, and stable result contracts.
 */

import type { RunCommand } from "../../../context.js";
import type {
  IssueIntegrityStatus,
  IssueRuntimeState,
  Project,
  WorkflowConfig,
} from "../../../domain/index.js";
import type { Issue, IssueProvider, ProviderRateLimitStatus } from "../../../integrations/index.js";
import type { ProjectionDiff, ProjectionMetadata } from "../../../projection/index.js";
import type { ResolvedRoleConfig } from "../../../state/index.js";
import type { ValueOf } from "../../../types.js";
import type {
  ISSUE_REPAIR_ERROR,
  ISSUE_REPAIR_SOURCE,
  REPAIR_ACTION,
  REPAIR_EVENT,
  REPAIR_LOCAL_FIELDS,
  REPAIR_METADATA_ACTION,
  REPAIR_MODE,
  REPAIR_STATUS,
  REPAIR_WARNING,
} from "./const.js";

/** Supported repair source. */
export type IssueRepairSource = ValueOf<typeof ISSUE_REPAIR_SOURCE>;

/** Stable repair failure code. */
export type IssueRepairErrorCode = ValueOf<typeof ISSUE_REPAIR_ERROR>;

/** Local runtime field permitted for explicit provider-source import. */
export type RepairLocalField = typeof REPAIR_LOCAL_FIELDS[number];

/** Stable operation reported by a repair plan or completed apply. */
export type RepairAction = ValueOf<typeof REPAIR_ACTION>;

/** Stable audit checkpoint emitted during repair. */
export type RepairEvent = ValueOf<typeof REPAIR_EVENT>;

/** One local field change proposed when provider projection is authoritative. */
export type IssueRepairLocalChange = {
  /** Allowed local runtime field selected for explicit provider-source import. */
  field: RepairLocalField;
  /** Value observed before the proposed mutation. */
  before: unknown;
  /** Value selected after the proposed mutation. */
  after: unknown;
};

/** Structured application result shared by CLI and plugin tool adapters. */
export type IssueRepairResult = {
  /** Whether the requested repair outcome completed without a classified failure. */
  success: boolean;
  /** Preview or explicit apply mode chosen by the caller. */
  mode: ValueOf<typeof REPAIR_MODE>;
  /** Stable repair outcome for adapters and operator guidance. */
  status: ValueOf<typeof REPAIR_STATUS>;
  /** Resolved project identity or its canonical slug in results. */
  project: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Explicitly selected authority for repairing inconsistent projections. */
  source: IssueRepairSource;
  /** Local integrity classification observed during planning. */
  integrityBefore: IssueIntegrityStatus;
  /** Verified local integrity classification after apply. */
  integrityAfter?: IssueIntegrityStatus;
  /** Detached authoritative runtime snapshot used by the plan. */
  localSnapshot: IssueRuntimeState;
  /** Detached provider snapshot used by the plan. */
  providerSnapshot: Issue;
  /** Provider-visible labels derived from the selected authoritative state. */
  expectedManagedLabels: string[];
  /** Managed projection differences before repair. */
  diffBefore: ProjectionDiff;
  /** Managed projection differences observed after repair. */
  diffAfter?: ProjectionDiff;
  /** Whether managed body metadata needs replacement. */
  metadataAction: ValueOf<typeof REPAIR_METADATA_ACTION>;
  /** Observed and authoritative metadata identity comparison. */
  metadataDiff: RepairMetadataDiff;
  /** Allowed field deltas for explicit provider-source repair. */
  localChanges: IssueRepairLocalChange[];
  /** Applied changes or whether a repair plan requires mutation. */
  changed: boolean;
  /** Stable operation identifiers proposed by the repair plan. */
  plannedActions: RepairAction[];
  /** Operation identifiers completed before the reported outcome. */
  appliedActions?: RepairAction[];
  /** Nonfatal preflight diagnostics. */
  warnings: RepairWarning[];
  /** Conservative request budget for the planned provider mutations. */
  estimatedProviderRequests: number;
  /** Provider quota snapshot when available. */
  rateLimitStatus?: ProviderRateLimitStatus;
  /** Digest binding apply to the previously reviewed snapshots. */
  planToken: string;
  /** Correlation identity shared by repair audit events. */
  auditCorrelationId?: string;
  /** Instructions for inspecting or resuming incomplete effects. */
  recoveryPlan?: string[];
  /** Classified failure with safe retry guidance. */
  error?: RepairErrorDetail;
};

/** Provider used for repair reads and mutations. */
export type RepairProvider = IssueProvider;

/** Input accepted by the shared repair use case after adapter-level validation and authorization. */
export type RepairManagedIssueInput = {
  /** Configured workspace containing authoritative project storage. */
  workspaceDir: string;
  /** Canonical project identifier addressing local stores. */
  projectSlug: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Explicitly selected authority for repairing inconsistent projections. */
  source: IssueRepairSource;
  /** Explicit permission to execute the previously planned operation. */
  apply?: boolean;
  /** Digest binding apply to the previously reviewed snapshots. */
  planToken?: string;
  /** Fresh eligibility refusal or operator-supplied explanation. */
  reason?: string;
  /** Operator or service identity recorded in audit. */
  actor: string;
  /** Adapter-provided origin used for audit attribution. */
  channelContext?: RepairChannelContext;
  /** Resolved provider adapter for issue reads and mutations. */
  provider?: RepairProvider;
  /** Runtime-owned provider command transport. */
  runCommand: RunCommand;
};

/** Fresh local and provider snapshots used under the issue lock. */
export type RepairContext = {
  /** Resolved project identity or its canonical slug in results. */
  project: Project;
  /** Resolved project workflow including custom terminal states. */
  workflow: WorkflowConfig;
  /** Resolved role definitions including valid custom levels. */
  roles: Record<string, ResolvedRoleConfig>;
  /** Detached authoritative local runtime record. */
  local: IssueRuntimeState;
  /** Detached issue returned by the provider lookup. */
  providerIssue: Issue;
  /** Resolved provider adapter for issue reads and mutations. */
  provider: RepairProvider;
};

/** Observed and expected managed body identity. */
type RepairMetadataDiff = {
  /** Observed managed metadata, or null when missing or invalid. */
  actual: ProjectionMetadata | null;
  /** Managed metadata derived from authoritative runtime state. */
  expected: ProjectionMetadata;
  /** Planned metadata mutation. */
  action: ValueOf<typeof REPAIR_METADATA_ACTION>;
};

/** Nonfatal diagnostic about repair preflight. */
type RepairWarning = {
  /** Stable diagnostic or failure classification. */
  code: ValueOf<typeof REPAIR_WARNING>;
  /** Operator-readable failure or warning detail. */
  message: string;
};

/** Classified failure and safe retry guidance. */
type RepairErrorDetail = {
  /** Stable diagnostic or failure classification. */
  code: IssueRepairErrorCode;
  /** Operator-readable failure or warning detail. */
  message: string;
  /** Whether a new attempt may succeed after refreshing state. */
  retryable: boolean;
  /** Earliest provider-suggested retry timestamp. */
  retryAfter?: string;
};

/** Adapter-supplied origin used solely for audit attribution. */
type RepairChannelContext = {
  /** Originating conversation identifier for audit. */
  channelId?: string;
  /** Originating transport account for audit. */
  accountId?: string;
};
