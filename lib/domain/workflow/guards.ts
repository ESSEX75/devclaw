/**
 * Validates membership in DevClaw's closed built-in workflow value sets.
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

/**
 * Check whether a value matches a built-in completion result.
 *
 * @param value - Untrusted value to validate.
 */
export function isCompletionResult(value: unknown): value is CompletionResult {
  return typeof value === "string"
    && Object.values(COMPLETION_RESULT).some((result) => result === value);
}

/**
 * Check whether a value matches a built-in role identifier.
 *
 * @param value - Untrusted value to validate against built-in roles only.
 */
export function isBuiltInRoleId(value: unknown): value is RoleId {
  return typeof value === "string"
    && Object.values(DEFAULT_ROLES).some((role) => role === value);
}

/**
 * Check whether a value matches a built-in level identifier.
 *
 * @param value - Untrusted value to validate against built-in levels only.
 */
export function isBuiltInLevelId(value: unknown): value is LevelId {
  return typeof value === "string"
    && Object.values(DEFAULT_LEVELS).some((level) => level === value);
}

/**
 * Check whether a value matches a supported review policy.
 *
 * @param value - Untrusted value to validate.
 */
export function isReviewPolicy(value: unknown): value is ReviewPolicy {
  return typeof value === "string" && Object.values(REVIEW_POLICY).some((policy) => policy === value);
}

/**
 * Check whether a value matches a supported test policy.
 *
 * @param value - Untrusted value to validate.
 */
export function isTestPolicy(value: unknown): value is TestPolicy {
  return typeof value === "string" && Object.values(TEST_POLICY).some((policy) => policy === value);
}

/**
 * Check whether a value matches a supported workflow event.
 *
 * @param value - Untrusted value to validate.
 */
export function isWorkflowEvent(value: unknown): value is WorkflowEvent {
  return typeof value === "string"
    && Object.values(WORKFLOW_EVENT).some((event) => event === value);
}
