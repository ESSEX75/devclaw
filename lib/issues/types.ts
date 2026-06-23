/**
 * issues/types.ts — Runtime state for DevClaw-managed provider issues.
 */

export type IssueProvider = "github" | "gitlab";

export type IssueIntegrityStatus =
  | "ok"
  | "projection_uninitialized"
  | "projection_drift"
  | "integrity_error";

export type NotifyTarget = {
  channel: string;
  name: string;
};

export type ActiveIssueWorker = {
  role: string;
  level: string;
  slotIndex: number;
  sessionKey: string | null;
  startedAt: string;
};

export type IssueRuntimeState = {
  projectSlug: string;
  issueId: number;
  provider: IssueProvider;
  managed: boolean;
  workflowState: string;
  workflowLabel: string;
  assignedRole?: string | null;
  assignedLevel?: string | null;
  owner?: string | null;
  reviewPolicy?: string | null;
  testPolicy?: string | null;
  notifyTarget?: NotifyTarget | null;
  branchContract?: unknown | null;
  activeWorker?: ActiveIssueWorker | null;
  integrityStatus: IssueIntegrityStatus;
  integrityErrors: string[];
  projectionVersion: number;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  archivedAt?: string | null;
};

export type ArchivedIssueSummary = {
  issueId: number;
  finalWorkflowState: string;
  closedAt: string;
  archivedAt: string;
  lastIntegrityStatus: IssueIntegrityStatus;
};

export type IssueArchive = {
  issues: Record<string, ArchivedIssueSummary>;
};

export type IssueStateStore = {
  version: 1;
  projectSlug: string;
  issues: Record<string, IssueRuntimeState>;
  archive: IssueArchive;
};

