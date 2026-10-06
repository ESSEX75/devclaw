/**
 * Defines the persisted managed-issue archive contract.
 */

import type { ArchivedIssueRecord } from "../../../domain/index.js";
import type { AttachmentPurgeCheckpoint } from "../../attachments/types.js";

/** Conditional cleanup request against the exact archive snapshot selected by application policy. */
export type ArchiveRetentionMutation = {
  /** Immutable record whose identity and contents must still match. */
  expected: ArchivedIssueRecord;
  /** Remove the archive record only after all attachment bytes are removed. */
  removeRecord: boolean;
  /** Application checkpoint called after the required state journal and before touching bytes. */
  beforeDelete: AttachmentPurgeCheckpoint;
};

/** Outcome of a conditional archive cleanup; stale or still-active records are untouched. */
export type ArchiveRetentionMutationResult = {
  /** Whether the exact selected record was processed. */
  applied: boolean;
  /** Whether attachment disposition was processed in this attempt. */
  attachmentsPurged: boolean;
  /** Whether the record was removed after successful cleanup. */
  recordRemoved: boolean;
};

/** Current project-local archive persisted in `issues.archive.json`. */
export type IssueArchiveStore = {
  /** Project slug that owns every archived record. */
  projectSlug: string;
  /** Records keyed by stable provider/project/issue identity. */
  issues: Record<string, ArchivedIssueRecord>;
};

/** Immutable archive update carrying both the replacement store and caller result. */
export type IssueArchiveUpdate<T> = {
  /** Complete archive that replaces the previously read snapshot. */
  store: IssueArchiveStore;
  /** Value returned to the transaction caller after persistence succeeds. */
  result: T;
};
