/**
 * IssueProvider — Abstract interface for issue tracker operations.
 *
 * Implementations: GitHub (gh CLI), GitLab (glab CLI).
 */
import type {
  AttachmentUploader,
  IssueDeleter,
  IssueReader,
  IssueWriter,
  LabelProjector,
  ProviderHealthCheck,
  PullRequestOperator,
  PullRequestReader,
  ReactionWriter,
  ReviewReader,
} from "./capabilities.js";

export * from "./types.js";

// ---------------------------------------------------------------------------
// Provider facade
// ---------------------------------------------------------------------------

export interface IssueProvider
  extends IssueReader,
    IssueWriter,
    IssueDeleter,
    LabelProjector,
    ReviewReader,
    PullRequestReader,
    PullRequestOperator,
    ReactionWriter,
    AttachmentUploader,
    ProviderHealthCheck {}
