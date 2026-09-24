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
import type { Issue, IssueProvider, ProviderRateLimitStatus } from "../../../integrations/providers/index.js";
import type { ProjectionDiff, ProjectionMetadata } from "../../../projection/index.js";
import type { ResolvedRoleConfig } from "../../../state/index.js";
import type { ISSUE_REPAIR_ERROR, ISSUE_REPAIR_SOURCE } from "./const.js";

/** Supported repair source. */
export type IssueRepairSource = typeof ISSUE_REPAIR_SOURCE[keyof typeof ISSUE_REPAIR_SOURCE];

/** Stable repair failure code. */
export type IssueRepairErrorCode = typeof ISSUE_REPAIR_ERROR[keyof typeof ISSUE_REPAIR_ERROR];

/** One local field change proposed when provider projection is authoritative. */
export type IssueRepairLocalChange = {
  field: "workflowState" | "workflowLabel" | "assignedRole" | "assignedLevel" | "owner" | "reviewPolicy" | "testPolicy" | "notifyTarget";
  before: unknown;
  after: unknown;
};

/** Structured application result shared by CLI and plugin tool adapters. */
export type IssueRepairResult = {
  success: boolean;
  mode: "dry_run" | "apply";
  status: "planned" | "repaired" | "already_consistent" | "blocked" | "partial_failure";
  project: string;
  issueId: number;
  source: IssueRepairSource;
  integrityBefore: IssueIntegrityStatus;
  integrityAfter?: IssueIntegrityStatus;
  localSnapshot: IssueRuntimeState;
  providerSnapshot: Issue;
  expectedManagedLabels: string[];
  diffBefore: ProjectionDiff;
  diffAfter?: ProjectionDiff;
  metadataAction: "none" | "replace";
  metadataDiff: {
    actual: ProjectionMetadata | null;
    expected: ProjectionMetadata;
    action: "none" | "replace";
  };
  localChanges: IssueRepairLocalChange[];
  changed: boolean;
  plannedActions: string[];
  appliedActions?: string[];
  warnings: Array<{ code: string; message: string }>;
  estimatedProviderRequests: number;
  rateLimitStatus?: ProviderRateLimitStatus;
  planToken: string;
  auditCorrelationId?: string;
  recoveryPlan?: string[];
  error?: { code: IssueRepairErrorCode; message: string; retryable: boolean; retryAfter?: string };
};


/** Provider used for repair reads and mutations. */
export type RepairProvider = IssueProvider;

/** Input accepted by the shared repair use case after adapter-level validation and authorization. */
export type RepairManagedIssueInput = {
  workspaceDir: string;
  projectSlug: string;
  issueId: number;
  source: IssueRepairSource;
  apply?: boolean;
  planToken?: string;
  reason?: string;
  actor: string;
  channelContext?: { channelId?: string; accountId?: string };
  provider?: RepairProvider;
  runCommand: RunCommand;
};


/** Fresh local and provider snapshots used under the issue lock. */
export type RepairContext = {
  project: Project;
  workflow: WorkflowConfig;
  roles: Record<string, ResolvedRoleConfig>;
  local: IssueRuntimeState;
  providerIssue: Issue;
  provider: RepairProvider;
};
