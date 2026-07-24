/**
 * issues/types.ts — Runtime state for DevClaw-managed provider issues.
 */
import type { SoftUnion } from "../../types.js";
import type { LevelId, ReviewPolicy, RoleId, TestPolicy, WorkflowLabel, WorkflowStateKey } from "../workflow/types.js";
import { ISSUE_INTEGRITY_STATUS, ISSUE_PROVIDER } from "./const.js";

/** Supported issue tracking provider kinds. */
export type IssueProvider = SoftUnion<typeof ISSUE_PROVIDER>;

/** Status of the issue's local state relative to the provider. */
export type IssueIntegrityStatus = SoftUnion<typeof ISSUE_INTEGRITY_STATUS>;

/** Local state details for issue synchronization and validation. */
export type IssueProjectionState = {
  /** Health status of the projection. **/
  integrityStatus: IssueIntegrityStatus;
  /** List of drift or integrity errors detected. */
  integrityErrors: string[];
  /** Version of the provider-side projection format. */
  projectionVersion: number;
};

/** Target endpoint details for issue notifications. */
export type NotifyTarget = {
  /** Notification channel type (e.g. telegram, slack). */
  channel: string;
  /** Channel target name/identifier. */
  name: string;
};

/** Git branches and pull request metadata associated with the issue. */
export type BranchContract = {
  /** Developer's working branch name. */
  branch?: string;
  /** Target base branch (e.g. main/master). */
  baseBranch?: string;
  /** URL of the opened pull request, if any. */
  pullRequestUrl?: string | null;
};

/** Details about the worker currently active on the issue. */
export type ActiveIssueWorker = {
  /** The assigned worker role (e.g. developer, tester). */
  role: RoleId;
  /** The assigned worker tier/level (e.g. junior, senior). */
  level: LevelId;
  /** Index of the worker slot. */
  slotIndex: number;
  /** Unique session key of the active run. */
  sessionKey: string | null;
  /** ISO timestamp when work started. */
  startedAt: string;
};

/** Main local runtime state for a managed provider issue. */
export type IssueRuntimeState = IssueProjectionState & {
  /** Slug of the project owning this issue. */
  projectSlug: string;
  /** Unique numeric identifier for the issue on the provider. */
  issueId: number;
  /** Provider host name. */
  provider: IssueProvider;
  /** Flag identifying this issue as managed by DevClaw. */
  managed: true;
  /** Current state key in the workflow statechart. */
  workflowState: WorkflowStateKey;
  /** Current display state label matching the provider label. */
  workflowLabel: WorkflowLabel;
  /** Role currently assigned to resolve the issue. */
  assignedRole?: RoleId | null;
  /** Developer level currently assigned. */
  assignedLevel?: LevelId | null;
  /** User name of the currently assigned human owner. */
  owner?: string | null;
  /** Override review policy for this issue. */
  reviewPolicy?: ReviewPolicy | null;
  /** Override test policy for this issue. */
  testPolicy?: TestPolicy | null;
  /** Overridden notify destination for this issue. */
  notifyTarget?: NotifyTarget | null;
  /** Branch and PR references. */
  branchContract?: BranchContract | null;
  /** Active session worker details. */
  activeWorker?: ActiveIssueWorker | null;
  /** ISO timestamp when managed state was created. */
  createdAt: string;
  /** ISO timestamp of the last state update. */
  updatedAt: string;
  /** ISO timestamp when the issue was closed. */
  closedAt?: string | null;
  /** ISO timestamp when the issue was archived. */
  archivedAt?: string | null;
};

/** Lightweight summary of an archived issue. */
export type ArchivedIssueSummary = {
  /** Issue identifier. */
  issueId: number;
  /** Final workflow state before archiving. */
  finalWorkflowState: WorkflowStateKey;
  /** ISO timestamp of issue closure. */
  closedAt: string;
  /** ISO timestamp of archiving. */
  archivedAt: string;
  /** Last recorded integrity status before archive. */
  lastIntegrityStatus: IssueIntegrityStatus;
};

/** Container for all archived issues. */
export type IssueArchive = {
  /** Map of issue IDs to their archived summaries. */
  issues: Record<string, ArchivedIssueSummary>;
};

/** Local filesystem state store schema for project issues. */
export type IssueStateStore = {
  /** Storage schema version. */
  version: 1;
  /** Project slug. */
  projectSlug: string;
  /** Active managed issues keyed by stringified issue ID. */
  issues: Record<string, IssueRuntimeState>;
  /** Archived issues index. */
  archive: IssueArchive;
};
