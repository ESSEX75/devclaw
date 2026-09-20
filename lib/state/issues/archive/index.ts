/** Exposes archive persistence and transfer transactions to the state package. */
export { readIssueArchiveStore, updateIssueArchiveStore } from "./repository.js";
export { archiveIssueState, resetIssueStores } from "./transaction.js";
export type { IssueArchiveStore } from "./types.js";
