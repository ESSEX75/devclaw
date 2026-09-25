/** Contracts for managed-label reconciliation and provider mutations. */
import type { WorkflowConfig } from "../../domain/index.js";
import type { IssueReader, LabelProjector } from "../../integrations/providers/index.js";
import type { ProjectionDiff } from "../../projection/index.js";

/** Small provider surface needed to read and mutate managed labels. */
export type ProjectionProvider = Pick<IssueReader, "getIssue">
  & Pick<LabelProjector, "ensureLabel" | "addLabel" | "removeLabels">;

/** One verified reconciliation and its original provider diff. */
export type ManagedProjectionResult = {
  /** Provider-local issue identifier. */
  issueId: number;
  /** Provider labels before mutation, detached from mutable adapter data. */
  before: string[];
  /** Managed-label changes requested from the original snapshot. */
  diff: ProjectionDiff;
  /** Whether the original snapshot needed managed-label changes. */
  changed: boolean;
};

/** Inputs for a locked, fresh-state projection pass. */
export type ReconcileManagedLabelsInput = {
  /** Workspace containing authoritative issue state. */
  workspaceDir: string;
  /** Canonical project owning the managed issue. */
  projectSlug: string;
  /** Provider-local issue identifier. */
  issueId: number;
  /** Resolved workflow that defines managed state labels. */
  workflow: WorkflowConfig;
  /** Resolved configured roles; workflow roles are used when omitted. */
  roles?: string[];
  /** Provider read and label mutation capability. */
  provider: ProjectionProvider;
  /** Operation name recorded in reconciliation audit and failure details. */
  owner: string;
};

/** Input for applying an already calculated managed-label diff without changing local integrity state. */
export type ApplyManagedLabelDiffInput = {
  /** Provider-local issue identifier. */
  issueId: number;
  /** Provider capability allowed to mutate labels. */
  provider: Pick<LabelProjector, "ensureLabel" | "addLabel" | "removeLabels">;
  /** Deterministic managed-label delta. */
  diff: ProjectionDiff;
  /** Resolved workflow used for label colors and state handling. */
  workflow: WorkflowConfig;
  /** Configured roles used for role label colors. */
  roles: string[];
};
