/**
 * sprints/types.ts — Local sprint execution graph types.
 *
 * This is runtime state. Provider milestones, labels, relationships, and
 * issue body metadata are projections or recovery inputs, not authority.
 */

export const SprintGraphStatus = {
  PLANNED: "planned",
  ACTIVE: "active",
  DONE: "done",
  FINAL_REVIEW_REQUIRED: "final_review_required",
  INTEGRITY_ERROR: "integrity_error",
} as const;
export type SprintGraphStatus = (typeof SprintGraphStatus)[keyof typeof SprintGraphStatus];

export const SprintStepStatus = {
  PLANNED: "planned",
  BLOCKED: "blocked",
  READY: "ready",
  ACTIVE: "active",
  REVIEW: "review",
  MERGED: "merged",
  DONE: "done",
  CONFLICT: "conflict",
  FINAL_REVIEW_REQUIRED: "final_review_required",
  INTEGRITY_ERROR: "integrity_error",
} as const;
export type SprintStepStatus = (typeof SprintStepStatus)[keyof typeof SprintStepStatus];

export type SprintStep = {
  issueId: number;
  order: number;
  workBranch: string;
  prTargetBranch: string;
  status: SprintStepStatus;
  blockedBy?: number[];
  prUrl?: string;
  updatedAt?: string;
};

export type SprintExecutionGraph = {
  projectSlug: string;
  sprintRootIssueId: number;
  milestone: string;
  sprintBranch: string;
  status: SprintGraphStatus;
  reviewPolicy?: string;
  sprintBlockedBy: number[];
  steps: SprintStep[];
  finalPrUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type SprintsData = {
  sprints: Record<string, SprintExecutionGraph>;
  archive?: Record<string, SprintExecutionGraph>;
};

export type SprintReadinessResolution = {
  ready: boolean;
  blockedBy: number[];
  reason:
    | "ready"
    | "sprint_blocked"
    | "step_blocked"
    | "already_active"
    | "terminal"
    | "missing_step"
    | "integrity_error";
};
