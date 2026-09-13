/**
 * Converts provider projection and explicit lifecycle choices into authoritative local issue state.
 */
import {
  type ActiveIssueWorker,
  findStateKeyByLabel,
  getCurrentStateLabel,
  ISSUE_INTEGRITY_STATUS,
  type IssueIntegrityStatus,
  type IssueProviderId,
  type IssueRuntimeState,
  type NotifyBindingRef,
  type Project,
  REVIEW_POLICY,
  type ReviewPolicy,
  TEST_POLICY,
  type TestPolicy,
  type WorkflowConfig,
} from "../../domain/index.js";
import type { Issue } from "../../integrations/providers/index.js";
import { updateIssueRuntimeRecord } from "../../state/index.js";

/** Application input combining provider projection with explicit lifecycle changes. */
export type IssueStateWriteInput = {
  /** Workspace containing authoritative local state. */
  workspaceDir: string;
  /** Project that owns the provider issue. */
  project: Pick<Project, "slug" | "channels">;
  /** Provider projection used only for explicit initialization. */
  issue: Pick<Issue, "iid" | "labels">;
  /** Provider selected by project configuration. */
  providerType: IssueProviderId;
  /** Durable creation saga identifier. */
  creationOperationId?: string;
  /** Resolved workflow used to interpret initialization labels. */
  workflow: WorkflowConfig;
  /** Explicit provider-facing workflow label. */
  workflowLabel?: string;
  /** Explicit canonical workflow state. */
  workflowState?: string;
  /** Explicit assigned role replacement. */
  assignedRole?: string | null;
  /** Explicit assigned level replacement. */
  assignedLevel?: string | null;
  /** Explicit DevClaw owner replacement. */
  owner?: string | null;
  /** Explicit notification binding replacement. */
  notifyTarget?: NotifyBindingRef | null;
  /** Explicit review policy replacement. */
  reviewPolicy?: ReviewPolicy | null;
  /** Explicit test policy replacement. */
  testPolicy?: TestPolicy | null;
  /** Explicit active worker replacement. */
  activeWorker?: ActiveIssueWorker | null;
  /** Explicit integrity status replacement. */
  integrityStatus?: IssueIntegrityStatus;
  /** Explicit closure timestamp replacement. */
  closedAt?: string | null;
};

/** Build and persist a runtime snapshot while preserving authoritative existing values. */
export async function writeIssueRuntimeState(input: IssueStateWriteInput): Promise<IssueRuntimeState> {
  const workflowLabel = input.workflowLabel ?? getCurrentStateLabel(input.issue.labels, input.workflow);

  if (!workflowLabel) throw new Error(`Issue #${input.issue.iid} has no recognized workflow label for issue state write.`);
  const workflowState = input.workflowState ?? findStateKeyByLabel(input.workflow, workflowLabel);

  if (!workflowState) throw new Error(`Cannot find workflow state key for label "${workflowLabel}".`);
  const detectedRoleLevel = detectRoleLevel(input.issue.labels);

  return updateIssueRuntimeRecord(input.workspaceDir, input.project.slug, input.issue.iid, (previous) => {
    const now = new Date().toISOString();

    return {
      projectSlug: input.project.slug,
      issueId: input.issue.iid,
      provider: input.providerType,
      creationOperationId: input.creationOperationId ?? previous?.creationOperationId,
      workflowState,
      workflowLabel,
      assignedRole: input.assignedRole !== undefined ? input.assignedRole : previous?.assignedRole ?? detectedRoleLevel?.role ?? null,
      assignedLevel: input.assignedLevel !== undefined ? input.assignedLevel : previous?.assignedLevel ?? detectedRoleLevel?.level ?? null,
      owner: input.owner !== undefined ? input.owner : previous?.owner ?? null,
      reviewPolicy: input.reviewPolicy !== undefined ? input.reviewPolicy : previous?.reviewPolicy ?? detectRouting(input.issue.labels, "review"),
      testPolicy: input.testPolicy !== undefined ? input.testPolicy : previous?.testPolicy ?? detectRouting(input.issue.labels, "test"),
      notifyTarget: input.notifyTarget !== undefined ? input.notifyTarget : previous?.notifyTarget ?? null,
      activeWorker: input.activeWorker !== undefined ? input.activeWorker : previous?.activeWorker ?? null,
      integrityStatus: input.integrityStatus ?? previous?.integrityStatus ?? ISSUE_INTEGRITY_STATUS.OK,
      integrityErrors: previous?.integrityErrors ?? [],
      projectionVersion: previous?.projectionVersion ?? 1,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      closedAt: input.closedAt !== undefined ? input.closedAt : previous?.closedAt ?? null,
      providerMissing: previous?.providerMissing ?? null,
      pipelineNotification: previous?.pipelineNotification ?? null,
    };
  });
}

/** Detect an initial configured role and level from provider projection labels. */
function detectRoleLevel(labels: string[]): { role: string; level: string } | null {
  for (const label of labels) {
    const [role, level, extra] = label.split(":");

    if (extra || !role || !level) continue;
    if (["review", "test", "notify", "owner", "devclaw"].includes(role)) continue;
    if (/^[a-z][a-z0-9_-]*$/.test(role) && /^[a-z][a-z0-9_-]*$/.test(level)) return { role, level };
  }

  return null;
}

function detectRouting(labels: string[], prefix: "review"): ReviewPolicy | null;
function detectRouting(labels: string[], prefix: "test"): TestPolicy | null;
function detectRouting(labels: string[], prefix: "review" | "test"): ReviewPolicy | TestPolicy | null {
  const value = labels.find((label) => label.startsWith(`${prefix}:`))?.slice(prefix.length + 1);

  if (prefix === "review") return value === REVIEW_POLICY.HUMAN || value === REVIEW_POLICY.AGENT || value === REVIEW_POLICY.SKIP ? value : null;

  return value === TEST_POLICY.AGENT || value === TEST_POLICY.SKIP ? value : null;
}
