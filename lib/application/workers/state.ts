/** Owns worker-slot reservation and the authoritative issue runtime commit. */
import {
  hasTestPhase, ISSUE_PROVIDER, producesReviewableWork, REVIEW_POLICY, TEST_POLICY,
} from "../../domain/index.js";
import type { ResolvedConfig } from "../../state/index.js";
import { activateWorker, deactivateWorker, readIssueStateStore } from "../../state/index.js";
import { writeIssueRuntimeState } from "../issue-runtime/index.js";
import { reconcileManagedLabelsLocked } from "../projection/index.js";
import type { DispatchOpts, DispatchPlan } from "./types.js";

/**
 * Reserve a concrete slot before provider and gateway side effects begin.
 * @param opts - Dispatch identity and project state location.
 * @param plan - Selected role, level, slot, and session key.
 */
export async function reserveDispatchSlot(opts: DispatchOpts, plan: DispatchPlan): Promise<void> {
  await activateWorker(opts.workspaceDir, opts.project.slug, plan.role, {
    issueId: opts.issueId,
    level: plan.level,
    sessionKey: plan.sessionKey,
    startTime: new Date().toISOString(),
    previousLabel: opts.fromLabel,
    slotIndex: plan.slotIndex,
    name: plan.botName,
  });
}

/**
 * Release only the slot still assigned to this issue after confirmed pre-delivery failure.
 * @param opts - Dispatch identity and project state location.
 * @param plan - Exact role, level, and slot reserved for this attempt.
 */
export async function releaseDispatchSlot(opts: DispatchOpts, plan: DispatchPlan): Promise<void> {
  await deactivateWorker(opts.workspaceDir, opts.project.slug, plan.role, {
    level: plan.level, slotIndex: plan.slotIndex, issueId: opts.issueId,
  });
}

/**
 * Persist the active worker from local truth, then reconcile its provider projection.
 * The caller holds the issue lock and retains the slot if this post-delivery step fails.
 * @param opts - Issue, project, provider, and ownership inputs.
 * @param plan - Worker identity selected before delivery.
 * @param config - Resolved workflow and roles used for projection.
 * @param providerLabels - Provider issue labels read after transition.
 */
export async function commitWorkerDispatch(
  opts: DispatchOpts,
  plan: DispatchPlan,
  config: ResolvedConfig,
  providerLabels: string[],
): Promise<void> {
  const { workspaceDir, project, issueId, role, level, fromLabel, toLabel, provider } = opts;
  const { workflow } = config;
  const current = (await readIssueStateStore(workspaceDir, project.slug)).issues[String(issueId)];
  const owner = current?.owner ?? opts.instanceName ?? null;
  const reviewPolicy = producesReviewableWork(workflow, role)
    ? workflow.reviewPolicy ?? REVIEW_POLICY.HUMAN : null;
  const testPolicy = hasTestPhase(workflow)
    ? workflow.testPolicy ?? TEST_POLICY.SKIP : null;

  await writeIssueRuntimeState({
    workspaceDir,
    project,
    issue: {
      iid: issueId,
      labels: providerLabels
        .filter((label) => label !== fromLabel && !label.startsWith(`${role}:`))
        .concat(toLabel, `${role}:${level}`),
    },
    providerType: project.provider === ISSUE_PROVIDER.GITHUB ? ISSUE_PROVIDER.GITHUB : ISSUE_PROVIDER.GITLAB,
    workflow,
    workflowLabel: toLabel,
    assignedRole: role,
    assignedLevel: level,
    owner,
    reviewPolicy,
    testPolicy,
    activeWorker: {
      role, level, slotIndex: plan.slotIndex, sessionKey: plan.sessionKey,
      startedAt: new Date().toISOString(),
    },
  });
  await reconcileManagedLabelsLocked({
    workspaceDir,
    projectSlug: project.slug,
    issueId,
    workflow,
    roles: Object.keys(config.roles),
    provider,
    owner: "worker_dispatch",
  });
}
