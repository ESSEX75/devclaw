import type { IssueId, LevelId, ProjectSlug, ProviderKind, RoleId, SessionKey, WorkflowLabel, WorkflowStateKey } from "./ids.js";
import type { ReviewPolicy, TestPolicy } from "./workflow/types.js";

export type IssueProvider = ProviderKind;

export type IssueIntegrityStatus =
  | "ok"
  | "projection_uninitialized"
  | "projection_drift"
  | "integrity_error";

export type IssueProjectionState = {
  integrityStatus: IssueIntegrityStatus;
  integrityErrors: string[];
  projectionVersion: number;
};

export type NotifyTarget = {
  channel: string;
  name: string;
};

export type BranchContract = {
  branch?: string;
  baseBranch?: string;
  pullRequestUrl?: string | null;
};

export type ActiveIssueWorker = {
  role: RoleId;
  level: LevelId;
  slotIndex: number;
  sessionKey: SessionKey | null;
  startedAt: string;
};

export type IssueRuntimeState = IssueProjectionState & {
  projectSlug: ProjectSlug;
  issueId: IssueId;
  provider: IssueProvider;
  managed: true;
  workflowState: WorkflowStateKey;
  workflowLabel: WorkflowLabel;
  assignedRole?: RoleId | null;
  assignedLevel?: LevelId | null;
  owner?: string | null;
  reviewPolicy?: ReviewPolicy | null;
  testPolicy?: TestPolicy | null;
  notifyTarget?: NotifyTarget | null;
  branchContract?: BranchContract | null;
  activeWorker?: ActiveIssueWorker | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  archivedAt?: string | null;
};

