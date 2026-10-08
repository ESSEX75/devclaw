/** Exposes provider-neutral contracts and selection until their responsibility boundaries migrate. */

export { PR_COMMENT_KIND, PR_STATE, PROVIDER_ISSUE_STATE, PROVIDER_REVIEW_STATE } from "./const.js";
export { createProvider } from "./factory.js";
export type {
  AttachmentUploader,
  AttachmentUploadInput,
  CreateIssueInput,
  Issue,
  IssueComment,
  IssueDeleter,
  IssueEditInput,
  IssueListFilter,
  IssueProvider,
  IssueReader,
  IssueWriter,
  LabelProjector,
  ProviderHealthCheck,
  ProviderOptions,
  ProviderRateLimitReader,
  ProviderRateLimitStatus,
  ProviderWithType,
  PrReviewComment,
  PrState,
  PrStatus,
  PullRequestOperator,
  PullRequestReader,
  ReactionWriter,
  ReviewReader,
  StateLabel,
} from "./types.js";
