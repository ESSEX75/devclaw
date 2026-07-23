import type { IssueIntegrityStatus, IssueRuntimeState } from "../../domain/index.js";

interface ArchivedIssueSummary {
  issueId: IssueRuntimeState["issueId"];
  finalWorkflowState: IssueRuntimeState["workflowState"];
  closedAt: string;
  archivedAt: string;
  lastIntegrityStatus: IssueIntegrityStatus;
}

interface IssueArchive {
  issues: Record<string, ArchivedIssueSummary>;
}

export interface IssueStateStore {
  /** Schema version, currently 1 */
  version: 1;
  projectSlug: IssueRuntimeState["projectSlug"];
  issues: Record<string, IssueRuntimeState>;
  archive: IssueArchive;
}
