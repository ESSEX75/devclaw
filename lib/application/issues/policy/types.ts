/** Contracts for policy administration of managed issues. */

import type { RunCommand } from "../../../context.js";
import type { IssueRuntimeState, ReviewPolicy, TestPolicy } from "../../../domain/index.js";
import { type IssueProvider } from "../../../integrations/index.js";
import { type ManagedProjectionResult } from "../../projection/index.js";

/** One policy mutation with its optional provider reconciliation result. */
export type IssuePolicyMigrationChange = {
  /** Provider-local issue identifier. */
  issueId: number;
  /** Value observed before the proposed mutation. */
  before: PolicySnapshot;
  /** Value selected after the proposed mutation. */
  after: PolicySnapshot;
  /** Provider reconciliation result after local policy persistence. */
  projection?: ManagedProjectionResult;
};

/** Summary returned by policy migration dry-run or apply. */
export type IssuePolicyMigrationResult = {
  /** Canonical project identifier addressing local stores. */
  projectSlug: string;
  /** Whether this invocation previews the operation without applying it. */
  dryRun: boolean;
  /** Applied changes or whether a repair plan requires mutation. */
  changed: IssuePolicyMigrationChange[];
  /** Selected issues for which no requested mutation was applied. */
  skipped: SkippedPolicyIssue[];
};

/** Selection and desired policy values for explicit migration. */
export type MigrationOptions = {
  /** Configured workspace containing authoritative project storage. */
  workspaceDir: string;
  /** Canonical project identifier addressing local stores. */
  projectSlug: string;
  /** Requested review policy; omitted values preserve local truth. */
  reviewPolicy?: ReviewPolicy;
  /** Requested test policy; omitted values preserve local truth. */
  testPolicy?: TestPolicy;
  /** Optional issue selection; omission includes all matching local records. */
  issueIds?: number[];
  /** Optional selection by configured workflow key. */
  workflowStates?: string[];
  /** Explicitly includes terminal or closed records in policy migration. */
  includeClosed?: boolean;
  /** Whether this invocation previews the operation without applying it. */
  dryRun?: boolean;
  /** Resolved provider adapter for issue reads and mutations. */
  provider?: IssueProvider;
  /** Runtime-owned provider command transport. */
  runCommand: RunCommand;
};

/** Result of planPolicyChange for callers and operator diagnostics. */
export type PolicyChangePlan = {
  /** Fresh eligibility refusal or operator-supplied explanation. */
  reason?: string;
  /** Proposed local policy delta, absent for skipped issues. */
  change?: IssuePolicyMigrationChange;
};

/** Canonical policy snapshot copied from authoritative issue state. */
type PolicySnapshot = Pick<IssueRuntimeState, "reviewPolicy" | "testPolicy">;

/** One selected issue for which no policy mutation was applied. */
type SkippedPolicyIssue = {
  /** Provider-local issue identifier. */
  issueId: number;
  /** Fresh eligibility refusal or operator-supplied explanation. */
  reason: string;
};
