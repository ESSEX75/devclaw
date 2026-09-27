/** Pure retention eligibility and bounded policy validation. */
import { type ArchivedIssueRecord, ISSUE_ARCHIVE_REASON } from "../../../domain/index.js";
import { DURATION_MULTIPLIERS, RETENTION_DURATION_PATTERN } from "./const.js";
import type { ArchiveExpiryInput } from "./types.js";

/** Parse a non-negative integral retention duration without overflow.
 * @param value - Duration with an explicit ms, s, m, h, or d unit.
 */
export function parseDuration(value: string): number {
  const match = RETENTION_DURATION_PATTERN.exec(value);

  if (!match) throw new Error(`Invalid duration "${value}".`);
  const result = Number(match[1]) * (DURATION_MULTIPLIERS[match[2]] ?? NaN);

  if (!Number.isSafeInteger(result)) throw new Error(`Duration "${value}" exceeds the safe range.`);

  return result;
}

/** Reject negative, fractional, or unbounded mutation budgets.
 * @param maxItems - Maximum records inspected for retention effects.
 */
export function validateRetentionBudget(maxItems: number): void {
  if (!Number.isSafeInteger(maxItems) || maxItems < 0) throw new Error("maxItems must be a non-negative safe integer.");
}

/** Select the provider-deleted or ordinary archive retention window.
 * @param record - Immutable archived record selected for planning.
 * @param opts - Retention windows and fixed evaluation time.
 */
export function isArchiveRecordExpired(record: ArchivedIssueRecord, opts: ArchiveExpiryInput): boolean {
  const retention = record.archiveReason === ISSUE_ARCHIVE_REASON.PROVIDER_DELETED ? opts.deletedProviderRetention : opts.archiveRetention;

  return Date.parse(record.archivedAt) <= opts.now - parseDuration(retention);
}
