/**
 * setup/sprint-readiness.ts — Sprint-mode reinit readiness checks.
 *
 * The invariant is deliberate: run all read-only provider checks before any
 * provider write. If write phase starts and then fails, report partial state
 * with the resources that were created before the failure.
 */
import type { IssueProvider, SprintReadinessCheck } from "../providers/provider.js";
import type { Project } from "../projects/index.js";
import type { ResolvedConfig } from "../config/index.js";
import { ReviewPolicy, TaskMode } from "../workflow/index.js";

export const SprintReinitState = {
  READY: "ready",
  REINIT_FAILED: "reinit_failed",
  REINIT_PARTIAL: "reinit_partial",
} as const;
export type SprintReinitState = (typeof SprintReinitState)[keyof typeof SprintReinitState];

export type CreatedSprintResource = {
  type: "label" | "milestone" | "branch" | "issue" | "pull_request";
  id: string;
};

export type SprintReinitResult = {
  state: SprintReinitState;
  blocking: SprintReadinessCheck[];
  warnings: SprintReadinessCheck[];
  created: CreatedSprintResource[];
};

export function sprintModeEnabled(config: ResolvedConfig): boolean {
  return config.workflow.taskMode === TaskMode.SPRINT;
}

export async function checkSprintReinitReadiness(args: {
  provider: IssueProvider;
  project: Pick<Project, "baseBranch">;
  config: ResolvedConfig;
}): Promise<SprintReinitResult> {
  if (!sprintModeEnabled(args.config)) {
    return {
      state: SprintReinitState.READY,
      blocking: [],
      warnings: [],
      created: [],
    };
  }

  const result = await args.provider.checkSprintReadiness({
    baseBranch: args.project.baseBranch,
    reviewPolicy: args.config.workflow.reviewPolicy,
  });

  const capabilities = await args.provider.getSprintCapabilities();
  const missing = Object.entries({
    issues: capabilities.issues,
    milestones: capabilities.milestones,
    branches: capabilities.branches,
    pullRequests: capabilities.pullRequests,
  }).filter(([, supported]) => !supported);

  const blocking: SprintReadinessCheck[] = [
    ...result.blocking,
    ...missing.map(([capability]) => ({
      code: "missing_sprint_capability" as const,
      message: `Provider lacks mandatory sprint capability: ${capability}.`,
      details: { capability },
    })),
  ];

  if (
    (args.config.workflow.reviewPolicy === ReviewPolicy.SPRINT ||
      args.config.workflow.reviewPolicy === ReviewPolicy.SKIP) &&
    !capabilities.autoMerge
  ) {
    blocking.push({
      code: "auto_merge_blocked",
      message: `reviewPolicy "${args.config.workflow.reviewPolicy}" requires provider auto-merge support.`,
      details: { reviewPolicy: args.config.workflow.reviewPolicy },
    });
  }

  return {
    state: blocking.length > 0 ? SprintReinitState.REINIT_FAILED : SprintReinitState.READY,
    blocking,
    warnings: result.warnings,
    created: [],
  };
}

export async function runSprintReadinessWritePhase(args: {
  readiness: SprintReinitResult;
  write: (recordCreated: (created: CreatedSprintResource) => void) => Promise<void>;
}): Promise<SprintReinitResult> {
  if (args.readiness.state !== SprintReinitState.READY) {
    return args.readiness;
  }

  const created: CreatedSprintResource[] = [];
  try {
    await args.write((resource) => created.push(resource));
    return {
      ...args.readiness,
      created,
    };
  } catch (err) {
    return {
      state: SprintReinitState.REINIT_PARTIAL,
      blocking: [{
        code: "provider_unavailable",
        message: `Sprint reinit write phase failed after partial writes: ${(err as Error).message}`,
      }],
      warnings: args.readiness.warnings,
      created,
    };
  }
}

export function assertSprintReady(result: SprintReinitResult): void {
  if (result.state === SprintReinitState.READY) return;
  const blocking = result.blocking.map((item) => item.message).join("; ");
  throw new Error(
    `Sprint mode is not ready (${result.state}). ` +
    `Run reinit/repair and resolve blocking checks first. ${blocking}`,
  );
}
