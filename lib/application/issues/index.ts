/** Exposes managed issue lifecycle commands and their supported results. */
export {
  archiveManagedIssue,
  getIssueArchiveStatus,
  maintainIssueArchive,
  parseDuration,
  purgeIssueArchive,
  recoverTerminalIssueArchives,
} from "./archive.js";
export { deleteManagedIssue } from "./delete.js";
export { migrateIssuePolicies } from "./policy-migration.js";
export type { IssueRepairSource } from "./repair.js";
export { isIssueRepairFailure, ISSUE_REPAIR_SOURCE, repairManagedIssue } from "./repair.js";
