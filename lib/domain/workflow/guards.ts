/**
 * workflow/guards.ts — Type guard functions for workflow domain entities.
 */
import {
  COMPLETION_RESULT,
  DEFAULT_LEVELS,
  DEFAULT_ROLES,
  REVIEW_POLICY,
  TEST_POLICY,
  WORKFLOW_EVENT,
} from "./const.js";
import type { CompletionResult, LevelId, ReviewPolicy, RoleId, TestPolicy, WorkflowEvent } from "./types.js";

/** Checks if a value matches a built-in completion result. */
export function isCompletionResult(value: unknown): value is CompletionResult {
  return typeof value === "string"
    && Object.values(COMPLETION_RESULT).some((result) => result === value);
}

/** Checks if a value matches a built-in role identifier. */
export function isBuiltInRoleId(value: unknown): value is RoleId {
  return typeof value === "string"
    && Object.values(DEFAULT_ROLES).some((role) => role === value);
}

/** Checks if a value matches a built-in level identifier. */
export function isBuiltInLevelId(value: unknown): value is LevelId {
  return typeof value === "string"
    && Object.values(DEFAULT_LEVELS).some((level) => level === value);
}

/** Check whether an unknown value is a configured review-routing policy value. */
export function isReviewPolicy(value: unknown): value is ReviewPolicy {
  return typeof value === "string" && Object.values(REVIEW_POLICY).some((policy) => policy === value);
}

/** Check whether an unknown value is a configured test-routing policy value. */
export function isTestPolicy(value: unknown): value is TestPolicy {
  return typeof value === "string" && Object.values(TEST_POLICY).some((policy) => policy === value);
}

/** Checks if a value matches a supported workflow event. */
export function isWorkflowEvent(value: unknown): value is WorkflowEvent {
  return typeof value === "string"
    && Object.values(WORKFLOW_EVENT).some((event) => event === value);
}
