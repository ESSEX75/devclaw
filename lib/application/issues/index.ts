/** Exposes managed issue lifecycle commands and their supported results. */

export {
  archiveManagedIssue,
  archiveManagedIssueLocked,
  getIssueArchiveStatus,
  maintainIssueArchive,
  parseDuration,
  purgeIssueArchive,
  recoverTerminalIssueArchives
} from "./archive/index.js";
export { deleteManagedIssue } from "./deletion/index.js";
export { migrateIssuePolicies } from "./policy/index.js";
export type { IssueRepairSource } from "./repair/index.js";
export { isIssueRepairFailure, ISSUE_REPAIR_SOURCE, repairManagedIssue } from "./repair/index.js";
