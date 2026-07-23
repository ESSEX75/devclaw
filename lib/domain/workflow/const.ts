/**
 * workflow/constants.ts — Workflow labels and routing constants.
 */

/** Known internal workflow state keys used across the pipeline. */
export const WORKFLOW_STATE_KEYS = {
  /** Initial state where requirements are being formulated. */
  PLANNING: "planning",
  /** Task is queued and ready to be picked up by a developer. */
  TODO: "todo",
  /** Task is actively in progress by a developer. */
  DOING: "doing",
  /** Developer completed work; task is queued for code review. */
  TO_REVIEW: "toReview",
  /** Reviewer or agent is actively reviewing the pull request. */
  REVIEWING: "reviewing",
  /** Task passed review and is queued for testing. */
  TO_TEST: "toTest",
  /** QA agent is actively running tests and verifying the build. */
  TESTING: "testing",
  /** Task is fully completed and changes are merged. */
  DONE: "done",
  /** Task was rejected and closed without being completed. */
  REJECTED: "rejected",
  /** Task failed review or testing; queued for developer fixes and improvements. */
  TO_IMPROVE: "toImprove",
  /** Architect completed work but is blocked; queued for refinement. */
  REFINING: "refining",
  /** Task is queued for architect/researcher design and research phase. */
  TO_RESEARCH: "toResearch",
  /** Architect/researcher is actively designing and researching the task. */
  RESEARCHING: "researching",
} as const;

/** Routing labels applied to issues to delegate tests or reviews. */
export const ROUTING_LABELS = {
  REVIEW_HUMAN: "review:human",
  REVIEW_AGENT: "review:agent",
  REVIEW_SKIP: "review:skip",
  TEST_SKIP: "test:skip",
  TEST_AGENT: "test:agent",
} as const;

/** Default built-in roles for the worker pipeline. */
export const DEFAULT_ROLES = {
  DEVELOPER: "developer",
  REVIEWER: "reviewer",
  TESTER: "tester",
  ARCHITECT: "architect",
} as const;

/** Default built-in developer tier/level options. */
export const DEFAULT_LEVELS = {
  JUNIOR: "junior",
  MEDIOR: "medior",
  SENIOR: "senior",
} as const;

/** Display labels for states on the provider issue trackers. */
export const WORKFLOW_STATE_LABELS = {
  PLANNING: "Planning",
  TODO: "To Do",
  DOING: "Doing",
  TO_REVIEW: "To Review",
  REVIEWING: "Reviewing",
  TO_TEST: "To Test",
  TESTING: "Testing",
  DONE: "Done",
  REJECTED: "Rejected",
  TO_IMPROVE: "To Improve",
  REFINING: "Refining",
  TO_RESEARCH: "To Research",
  RESEARCHING: "Researching",
} as const;

/** Corresponding colors for workflow state labels. */
export const WORKFLOW_STATE_COLORS = {
  PLANNING: "#95a5a6",
  TODO: "#0366d6",
  DOING: "#f0ad4e",
  TO_REVIEW: "#7057ff",
  REVIEWING: "#c5def5",
  TO_TEST: "#5bc0de",
  TESTING: "#9b59b6",
  DONE: "#5cb85c",
  REJECTED: "#e11d48",
  TO_IMPROVE: "#d9534f",
  REFINING: "#f39c12",
  TO_RESEARCH: "#0075ca",
  RESEARCHING: "#4a90e2",
} as const;

/** Built-in execution modes for role and project parallelism. */
export const EXECUTION_MODE = {
  PARALLEL: "parallel",
  SEQUENTIAL: "sequential",
} as const;

/** Review policy for PR review after developer completion. */
export const REVIEW_POLICY = {
  HUMAN: "human",
  AGENT: "agent",
  SKIP: "skip",
} as const;

/** Test policy for automated testing after review. */
export const TEST_POLICY = {
  SKIP: "skip",
  AGENT: "agent",
} as const;

/** Built-in transition actions. Custom actions are also valid — these are just the ones with built-in handlers. */
export const ACTION = {
  GIT_PULL: "gitPull",
  DETECT_PR: "detectPr",
  MERGE_PR: "mergePr",
  CLOSE_ISSUE: "closeIssue",
  REOPEN_ISSUE: "reopenIssue",
} as const;

/** Built-in review check types for review states. */
export const REVIEW_CHECK = {
  PR_APPROVED: "prApproved",
  PR_MERGED: "prMerged",
} as const;

/** Built-in workflow events. */
export const WORKFLOW_EVENT = {
  PICKUP: "PICKUP",
  COMPLETE: "COMPLETE",
  REVIEW: "REVIEW",
  APPROVED: "APPROVED",
  MERGE_FAILED: "MERGE_FAILED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  MERGE_CONFLICT: "MERGE_CONFLICT",
  PASS: "PASS",
  FAIL: "FAIL",
  SKIP: "SKIP",
  REFINE: "REFINE",
  BLOCKED: "BLOCKED",
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  PR_CLOSED: "PR_CLOSED",
} as const;


/** Built-in state types. */
export const STATE_TYPE = {
  QUEUE: "queue",
  ACTIVE: "active",
  HOLD: "hold",
  TERMINAL: "terminal",
} as const;

/** Step routing label values — per-issue overrides for workflow steps. */
export const STEP_ROUTING = {
  HUMAN: "human",
  AGENT: "agent",
  SKIP: "skip",
} as const;

/** Default colors per role for role:level labels. */
export const ROLE_LABEL_COLORS = {
  DEVELOPER: "#0e8a16",
  TESTER: "#5319e7",
  ARCHITECT: "#0075ca",
  REVIEWER: "#d93f0b",
} as const;
