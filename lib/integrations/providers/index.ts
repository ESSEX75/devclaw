/** Exposes provider-neutral contracts, classified failures and the supported factory. */

export { PR_COMMENT_KIND, PR_STATE, PROVIDER_ISSUE_STATE, PROVIDER_REVIEW_STATE } from "./const.js";
export { createProvider } from "./factory.js";
export * from "./lookup-errors.js";
export * from "./operation-errors.js";
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
  ProviderAdapterOptions,
  ProviderCommandMode,
  ProviderHealthCheck,
  ProviderOperationErrorCode,
  ProviderOptions,
  ProviderRateLimitReader,
  ProviderRateLimitStatus,
  ProviderTransportFailure,
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
