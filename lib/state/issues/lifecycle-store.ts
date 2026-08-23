/**
 * issues/lifecycle.ts — Additive writes from existing issue lifecycle paths.
 */
import {
  type ActiveIssueWorker,
  detectOwner,
  findStateKeyByLabel,
  getCurrentStateLabel,
  isNotificationChannel,
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  type IssueIntegrityStatus,
  type IssueProviderId,
  type IssueRuntimeState,
  NOTIFY_LABEL_PREFIX,
  type NotifyTarget,
  type Project,
  REVIEW_POLICY,
  type ReviewPolicy,
  TEST_POLICY,
  type TestPolicy,
  type WorkflowConfig,
} from "../../domain/index.js";
import type { Issue } from "../../integrations/providers/provider.js";
import { updateIssueStateStore } from "./store.js";

export type IssueStateWriteInput = {
  workspaceDir: string;
  project: Pick<Project, "slug" | "channels">;
  issue: Pick<Issue, "iid" | "labels" | "state">;
  providerType: IssueProviderId;
  workflow: WorkflowConfig;
  workflowLabel?: string;
  workflowState?: string;
  assignedRole?: string | null;
  assignedLevel?: string | null;
  owner?: string | null;
  notifyTarget?: NotifyTarget | null;
  reviewPolicy?: ReviewPolicy | null;
  testPolicy?: TestPolicy | null;
  activeWorker?: ActiveIssueWorker | null;
  integrityStatus?: IssueIntegrityStatus;
  closedAt?: string | null;
  archivedAt?: string | null;
};

type RoleLevel = {
  role: string;
  level: string;
};

export function detectNotifyTarget(
  labels: string[],
  channels: Pick<Project, "channels">["channels"],
): NotifyTarget | null {
  const notifyLabel = labels.find((label) => label.startsWith(NOTIFY_LABEL_PREFIX));

  if (!notifyLabel) return null;
  const value = notifyLabel.slice(NOTIFY_LABEL_PREFIX.length);
  const colonIdx = value.indexOf(":");

  if (colonIdx === -1) {
    const channel = channels.find((ch) => ch.channelId === value);

    return channel ? { channel: channel.channel, name: channel.name } : null;
  }

  const channel = value.slice(0, colonIdx);

  return isNotificationChannel(channel)
    ? { channel, name: value.slice(colonIdx + 1) }
    : null;
}

export function detectRoleLevel(labels: string[]): RoleLevel | null {
  for (const label of labels) {
    const parts = label.split(":");

    if (parts.length !== 2) continue;
    const [role, level] = parts;

    if (!role || !level) continue;
    if (role === "review" || role === "test" || role === "notify" || role === "owner" || role === "devclaw") continue;

    if (isConfiguredIdentifier(role) && isConfiguredIdentifier(level)) return { role, level };
  }

  return null;
}

function detectRouting(labels: string[], prefix: "review"): ReviewPolicy | null;
function detectRouting(labels: string[], prefix: "test"): TestPolicy | null;
function detectRouting(labels: string[], prefix: "review" | "test"): ReviewPolicy | TestPolicy | null {
  const label = labels.find((candidate) => candidate.startsWith(`${prefix}:`));
  const value = label ? label.slice(prefix.length + 1) : null;

  if (prefix === "review") {
    return value === REVIEW_POLICY.HUMAN || value === REVIEW_POLICY.AGENT || value === REVIEW_POLICY.SKIP ? value : null;
  }

  return value === TEST_POLICY.AGENT || value === TEST_POLICY.SKIP ? value : null;
}

export async function writeIssueRuntimeState(input: IssueStateWriteInput): Promise<IssueRuntimeState> {
  const labels = input.issue.labels;
  const detectedWorkflowLabel = input.workflowLabel ?? getCurrentStateLabel(labels, input.workflow);

  if (!detectedWorkflowLabel) {
    throw new Error(`Issue #${input.issue.iid} has no recognized workflow label for issue state write.`);
  }

  const detectedRoleLevel = detectRoleLevel(labels);
  const foundStateKey = input.workflowState ?? findStateKeyByLabel(input.workflow, detectedWorkflowLabel);

  if (!foundStateKey) {
    throw new Error(`Cannot find workflow state key for label "${detectedWorkflowLabel}".`);
  }

  const workflowState = foundStateKey;
  const now = new Date().toISOString();

  let written!: IssueRuntimeState;

  await updateIssueStateStore(input.workspaceDir, input.project.slug, (store) => {
    const previous = store.issues[String(input.issue.iid)];

    written = {
      projectSlug: input.project.slug,
      issueId: input.issue.iid,
      provider: input.providerType,
      workflowState,
      workflowLabel: detectedWorkflowLabel,
      assignedRole: input.assignedRole !== undefined ? input.assignedRole : detectedRoleLevel?.role ?? previous?.assignedRole ?? null,
      assignedLevel: input.assignedLevel !== undefined ? input.assignedLevel : detectedRoleLevel?.level ?? previous?.assignedLevel ?? null,
      owner: input.owner !== undefined ? input.owner : detectOwner(labels) ?? previous?.owner ?? null,
      reviewPolicy: input.reviewPolicy !== undefined ? input.reviewPolicy : detectRouting(labels, "review") ?? previous?.reviewPolicy ?? null,
      testPolicy: input.testPolicy !== undefined ? input.testPolicy : detectRouting(labels, "test") ?? previous?.testPolicy ?? null,
      notifyTarget: input.notifyTarget !== undefined ? input.notifyTarget : detectNotifyTarget(labels, input.project.channels) ?? previous?.notifyTarget ?? null,
      branchContract: previous?.branchContract ?? null,
      activeWorker: input.activeWorker !== undefined ? input.activeWorker : previous?.activeWorker ?? null,
      integrityStatus: input.integrityStatus ?? previous?.integrityStatus ?? ISSUE_INTEGRITY_STATUS.OK,
      integrityErrors: previous?.integrityErrors ?? [],
      projectionVersion: previous?.projectionVersion ?? 1,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      closedAt: input.closedAt !== undefined ? input.closedAt : previous?.closedAt ?? null,
      archivedAt: input.archivedAt !== undefined ? input.archivedAt : previous?.archivedAt ?? null,
    };
    store.issues[String(input.issue.iid)] = written;
  });

  return written;
}

/** Persist the role-specific level selected for an initialized managed issue. */
export async function writeIssueRoleLevel(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  role: string,
  level: string,
): Promise<IssueRuntimeState> {
  return updateIssueStateStore(workspaceDir, projectSlug, (store) => {
    const state = store.issues[String(issueId)];

    if (!state) {
      throw new Error(`Issue #${issueId} has no initialized local runtime state.`);
    }

    state.assignedRole = role;
    state.assignedLevel = level;
    state.updatedAt = new Date().toISOString();

    return state;
  });
}

export function providerKindFromProject(project: Pick<Project, "provider">): IssueProviderId {
  return project.provider === ISSUE_PROVIDER.GITHUB ? ISSUE_PROVIDER.GITHUB : ISSUE_PROVIDER.GITLAB;
}

function isConfiguredIdentifier(value: string): boolean {
  return /^[a-z][a-z0-9_-]*$/.test(value);
}
