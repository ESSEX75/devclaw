/** Exposes archive persistence and transfer transactions to the state package. */
export { emptyIssueArchiveStore, readIssueArchiveStore, updateIssueArchiveStore, writeIssueArchiveStore } from "./repository.js";
export { archiveIssueState, resetIssueStores } from "./transaction.js";
export type { IssueArchiveStore, IssueArchiveUpdate } from "./types.js";
