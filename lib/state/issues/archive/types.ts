/**
 * Defines the persisted managed-issue archive contract.
 */
import type { ArchivedIssueRecord } from "../../../domain/index.js";

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
