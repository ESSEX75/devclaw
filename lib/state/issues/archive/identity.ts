/**
 * Defines stable keys for records in the managed-issue archive store.
 */
import type { ArchivedIssueRecord } from "../../../domain/index.js";

/**
 * Build the stable archive key for one provider issue.
 *
 * @param record - Provider, project, and issue identity retained by the archive record.
 */
export function issueArchiveKey(
  record: Pick<ArchivedIssueRecord, "provider" | "projectSlug" | "issueId">,
): string {
  return `${record.provider}:${record.projectSlug}:${record.issueId}`;
}
