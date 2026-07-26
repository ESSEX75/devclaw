/**
 * workflow/const.ts — Workflow labels and routing constants.
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
  /** Require human code review. */
  REVIEW_HUMAN: "review:human",
  /** Delegate code review to an AI reviewer agent. */
  REVIEW_AGENT: "review:agent",
  /** Skip code review step. */
  REVIEW_SKIP: "review:skip",
  /** Skip testing step. */
  TEST_SKIP: "test:skip",
  /** Delegate testing to an AI QA agent. */
  TEST_AGENT: "test:agent",
} as const;

/** Default built-in roles for the worker pipeline. */
export const DEFAULT_ROLES = {
  /** Developer role responsible for writing code and resolving issues. */
  DEVELOPER: "developer",
  /** Reviewer role responsible for inspecting pull requests. */
  REVIEWER: "reviewer",
  /** Tester role responsible for verifying builds and test suites. */
  TESTER: "tester",
  /** Architect role responsible for research and system design. */
  ARCHITECT: "architect",
} as const;

/** Default built-in developer tier/level options. */
export const DEFAULT_LEVELS = {
  /** Entry-level worker tier. */
  JUNIOR: "junior",
  /** Mid-level worker tier. */
  MEDIOR: "medior",
  /** Senior-level worker tier. */
  SENIOR: "senior",
} as const;

/** Display labels for states on the provider issue trackers. */
export const WORKFLOW_STATE_LABELS = {
  /** Display label for planning state. */
  PLANNING: "Planning",
  /** Display label for todo state. */
  TODO: "To Do",
  /** Display label for doing state. */
  DOING: "Doing",
  /** Display label for to-review state. */
  TO_REVIEW: "To Review",
  /** Display label for reviewing state. */
  REVIEWING: "Reviewing",
  /** Display label for to-test state. */
  TO_TEST: "To Test",
  /** Display label for testing state. */
  TESTING: "Testing",
  /** Display label for done state. */
  DONE: "Done",
  /** Display label for rejected state. */
  REJECTED: "Rejected",
  /** Display label for to-improve state. */
  TO_IMPROVE: "To Improve",
  /** Display label for refining state. */
  REFINING: "Refining",
  /** Display label for to-research state. */
  TO_RESEARCH: "To Research",
  /** Display label for researching state. */
  RESEARCHING: "Researching",
} as const;

/** Corresponding colors for workflow state labels. */
export const WORKFLOW_STATE_COLORS = {
  /** Hex color for planning label. */
  PLANNING: "#95a5a6",
  /** Hex color for todo label. */
  TODO: "#0366d6",
  /** Hex color for doing label. */
  DOING: "#f0ad4e",
  /** Hex color for to-review label. */
  TO_REVIEW: "#7057ff",
  /** Hex color for reviewing label. */
  REVIEWING: "#c5def5",
  /** Hex color for to-test label. */
  TO_TEST: "#5bc0de",
  /** Hex color for testing label. */
  TESTING: "#9b59b6",
  /** Hex color for done label. */
  DONE: "#5cb85c",
  /** Hex color for rejected label. */
  REJECTED: "#e11d48",
  /** Hex color for to-improve label. */
  TO_IMPROVE: "#d9534f",
  /** Hex color for refining label. */
  REFINING: "#f39c12",
  /** Hex color for to-research label. */
  TO_RESEARCH: "#0075ca",
  /** Hex color for researching label. */
  RESEARCHING: "#4a90e2",
} as const;

/** Built-in execution modes for role and project parallelism. */
export const EXECUTION_MODE = {
  /** Parallel execution mode. */
  PARALLEL: "parallel",
  /** Sequential execution mode. */
  SEQUENTIAL: "sequential",
} as const;

/** Review policy for PR review after developer completion. */
export const REVIEW_POLICY = {
  /** Code review delegated to human engineer. */
  HUMAN: "human",
  /** Code review delegated to AI agent. */
  AGENT: "agent",
  /** Code review skipped. */
  SKIP: "skip",
} as const;

/** Test policy for automated testing after review. */
export const TEST_POLICY = {
  /** Automated testing skipped. */
  SKIP: "skip",
  /** Automated testing delegated to AI agent. */
  AGENT: "agent",
} as const;

/** Built-in transition actions with handler implementations. */
export const ACTION = {
  /** Pull latest git changes into repository. */
  GIT_PULL: "gitPull",
  /** Detect opened pull request for current issue. */
  DETECT_PR: "detectPr",
  /** Merge pull request into base branch. */
  MERGE_PR: "mergePr",
  /** Close provider issue. */
  CLOSE_ISSUE: "closeIssue",
  /** Reopen closed provider issue. */
  REOPEN_ISSUE: "reopenIssue",
} as const;

/** Built-in review check types for review states. */
export const REVIEW_CHECK = {
  /** Verify that pull request has been approved. */
  PR_APPROVED: "prApproved",
  /** Verify that pull request has been merged. */
  PR_MERGED: "prMerged",
} as const;

/** Built-in workflow transition trigger events. */
export const WORKFLOW_EVENT = {
  /** Event triggered when worker picks up a task. */
  PICKUP: "PICKUP",
  /** Event triggered when worker completes work. */
  COMPLETE: "COMPLETE",
  /** Event triggered when task is sent for review. */
  REVIEW: "REVIEW",
  /** Event triggered when PR is approved. */
  APPROVED: "APPROVED",
  /** Event triggered when PR merge fails. */
  MERGE_FAILED: "MERGE_FAILED",
  /** Event triggered when reviewer requests changes. */
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  /** Event triggered when PR has merge conflicts. */
  MERGE_CONFLICT: "MERGE_CONFLICT",
  /** Event triggered when testing passes. */
  PASS: "PASS",
  /** Event triggered when testing fails. */
  FAIL: "FAIL",
  /** Event triggered when step is skipped. */
  SKIP: "SKIP",
  /** Event triggered when task needs refinement. */
  REFINE: "REFINE",
  /** Event triggered when task is blocked. */
  BLOCKED: "BLOCKED",
  /** Event triggered on manual approval. */
  APPROVE: "APPROVE",
  /** Event triggered on manual rejection. */
  REJECT: "REJECT",
  /** Event triggered when PR is closed without merge. */
  PR_CLOSED: "PR_CLOSED",
} as const;

/** Built-in workflow state behavior types. */
export const STATE_TYPE = {
  /** Queue state waiting for worker pickup. */
  QUEUE: "queue",
  /** Active state currently being processed by worker. */
  ACTIVE: "active",
  /** Hold state waiting on external action or approval. */
  HOLD: "hold",
  /** Terminal state concluding the workflow (e.g. done, rejected). */
  TERMINAL: "terminal",
} as const;

/** Step routing label values — per-issue overrides for workflow steps. */
export const STEP_ROUTING = {
  /** Route step to human worker. */
  HUMAN: "human",
  /** Route step to AI agent worker. */
  AGENT: "agent",
  /** Skip this workflow step. */
  SKIP: "skip",
} as const;

/** Default colors per role for role:level labels. */
export const ROLE_LABEL_COLORS = {
  /** Green label color for developer role. */
  DEVELOPER: "#0e8a16",
  /** Purple label color for tester role. */
  TESTER: "#5319e7",
  /** Blue label color for architect role. */
  ARCHITECT: "#0075ca",
  /** Orange label color for reviewer role. */
  REVIEWER: "#d93f0b",
} as const;

/** Color used for workflow step routing labels. */
export const STEP_ROUTING_COLOR = "#d93f0b";

/** Prefix used for notification routing labels. */
export const NOTIFY_LABEL_PREFIX = "notify:";

/** Color used for notification routing labels. */
export const NOTIFY_LABEL_COLOR = "#e4e4e4";

/** Prefix used for instance ownership labels. */
export const OWNER_LABEL_PREFIX = "owner:";

/** Color used for instance ownership labels. */
export const OWNER_LABEL_COLOR = "#e4e4e4";

/** Default fallback color for unknown roles. */
export const DEFAULT_ROLE_LABEL_COLOR = "#cccccc";

/** Emoji displayed for known worker completion results. */
export const RESULT_EMOJI = {
  DONE: "✅",
  PASS: "🎉",
  FAIL: "❌",
  REFINE: "🤔",
  BLOCKED: "🚫",
  APPROVE: "✅",
  REJECT: "❌",
} as const;

/** Fallback emoji displayed for an unknown completion result. */
export const DEFAULT_RESULT_EMOJI = "📋";
