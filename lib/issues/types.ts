/**
 * issues/types.ts — Runtime state for DevClaw-managed provider issues.
 */

export type {
  ActiveIssueWorker,
  BranchContract,
  IssueIntegrityStatus,
  IssueProjectionState,
  IssueProvider,
  IssueRuntimeState,
  NotifyTarget,
} from "../domain/issue.js";

import type { IssueIntegrityStatus, IssueRuntimeState } from "../domain/issue.js";

export type IssueRuntimeStateInput = Omit<IssueRuntimeState,
  "integrityStatus" | "integrityErrors" | "projectionVersion" | "createdAt" | "updatedAt"
> & Partial<Pick<IssueRuntimeState,
  "integrityStatus" | "integrityErrors" | "projectionVersion" | "createdAt" | "updatedAt"
>>;

export type ArchivedIssueSummary = {
  issueId: IssueRuntimeState["issueId"];
  finalWorkflowState: IssueRuntimeState["workflowState"];
  closedAt: string;
  archivedAt: string;
  lastIntegrityStatus: IssueIntegrityStatus;
};

export type IssueArchive = {
  issues: Record<string, ArchivedIssueSummary>;
};

export type IssueStateStore = {
  version: 1;
  projectSlug: IssueRuntimeState["projectSlug"];
  issues: Record<string, IssueRuntimeState>;
  archive: IssueArchive;
};
