/** Exposes supported managed-issue semantics to the domain package. */
export {
  ATTACHMENT_DISPOSITION,
  ISSUE_ARCHIVE_REASON,
  ISSUE_CREATION_ERROR,
  ISSUE_CREATION_STATUS,
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  OWNER_LABEL_COLOR,
  OWNER_LABEL_PREFIX,
  PIPELINE_NOTIFICATION_STATUS,
} from "./const.js";
export { detectOwner, getOwnerLabel, isOwnedByOrUnclaimed } from "./ownership.js";
export type {
  ActiveIssueWorker,
  ArchivedIssueRecord,
  AttachmentDisposition,
  IssueArchiveReason,
  IssueCreationErrorCode,
  IssueCreationStatus,
  IssueIntegrityStatus,
  IssueProjectionState,
  IssueProviderId,
  IssueRuntimeState,
  PipelineNotificationState,
  ProviderMissingState,
} from "./types.js";
