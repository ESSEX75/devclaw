/**
 * Defines the persisted active managed-issue store contract.
 */
import type { IssueRuntimeState } from "../../../domain/index.js";

/** Current project-local active issue store persisted in `issues.json`. */
export type IssueStateStore = {
  /** Project slug that owns every active issue. */
  projectSlug: string;
  /** Active managed issues keyed by provider-local issue ID. */
  issues: Record<string, IssueRuntimeState>;
};

/** Immutable repository update carrying both the replacement store and caller result. */
export type IssueStateUpdate<T> = {
  /** Complete store that replaces the previously read snapshot. */
  store: IssueStateStore;
  /** Value returned to the transaction caller after persistence succeeds. */
  result: T;
};
