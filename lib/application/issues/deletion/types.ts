/** Contracts for deletion administration of managed issues. */

import { type IssueProvider } from "../../../integrations/providers/contracts/index.js";

/** Structured result for dry-run, success, or recoverable partial failure. */
export type DeleteManagedIssueResult = {
  /** Provider-local issue identifier. */
  issueId: number;
  /** Whether this invocation previews the operation without applying it. */
  dryRun: boolean;
  /** Whether provider absence was confirmed. */
  deleted: boolean;
  /** Whether archival completed for the selected issue. */
  archived: boolean;
  /** Identity linking all checkpoints of this operation. */
  correlationId: string;
  /** Operator-readable sequence of requested effects. */
  plan: string[];
  /** Instructions for inspecting or resuming incomplete effects. */
  recoveryPlan?: string[];
};

/** Input to deleteManagedIssue using resolved project dependencies. */
export type DeleteManagedIssueInput = {
  /** Configured workspace containing authoritative project storage. */
  workspaceDir: string;
  /** Canonical project identifier addressing local stores. */
  projectSlug: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Exact numeric confirmation required for destructive provider deletion. */
  confirmIssueId?: number;
  /** Whether this invocation previews the operation without applying it. */
  dryRun?: boolean;
  /** Resolved provider adapter for issue reads and mutations. */
  provider: IssueProvider;
  /** Operator or service identity recorded in audit. */
  actor: string;
};
