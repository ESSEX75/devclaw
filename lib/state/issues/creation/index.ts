/** Exposes resumable issue-creation persistence to the state package. */
export {
  isIssueCreationReady,
  newIssueCreationIdentity,
  readIssueCreationStore,
  updateIssueCreationStore,
  withIssueCreationLock,
} from "./repository.js";
export type {
  IssueCreationFailure,
  IssueCreationOperation,
} from "./types.js";
