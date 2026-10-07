/** Exposes provider-neutral contracts, classified failures and the supported factory. */

export { PR_COMMENT_KIND, PR_STATE, PROVIDER_ISSUE_LOOKUP_ERROR, PROVIDER_ISSUE_STATE, PROVIDER_OPERATION_ERROR, PROVIDER_REVIEW_STATE } from "./const.js";
export { createProvider } from "./factory.js";
export { isProviderIssueLookupError, isProviderOperationError } from "./guards.js";
export { ProviderIssueLookupError } from "./lookup-errors.js";
export { ProviderOperationError } from "./operation-errors.js";
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
  ProviderIssueLookupErrorCode,
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
