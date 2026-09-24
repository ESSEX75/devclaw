/**
 * Maps repair failures into stable adapter-visible errors and recovery plans.
 */
import { isProviderIssueLookupError, PROVIDER_ISSUE_LOOKUP_ERROR } from "../../../integrations/providers/index.js";
import { ISSUE_REPAIR_ERROR } from "./const.js";
import type { IssueRepairErrorCode, IssueRepairResult } from "./types.js";

/** Typed repair failure preserved across application, CLI, and plugin boundaries. */
export class IssueRepairFailure extends Error {
  readonly code: IssueRepairErrorCode;
  readonly retryable: boolean;

  constructor(code: IssueRepairErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "IssueRepairFailure";
    this.code = code;
    this.retryable = retryable;
  }
}

/** Check whether a caught value is a stable repair failure. */
export function isIssueRepairFailure(error: unknown): error is IssueRepairFailure {
  return error instanceof IssueRepairFailure;
}


/** Return a blocked repair result with a stable code. */
export function blocked(plan: IssueRepairResult, code: IssueRepairErrorCode, message: string, retryable: boolean): IssueRepairResult {
  return { ...plan, success: false, status: "blocked", error: { code, message, retryable } };
}

/** Map an apply failure without losing the planned snapshot. */
export function mapRepairFailure(plan: IssueRepairResult, error: unknown): IssueRepairResult {
  if (isIssueRepairFailure(error)) {
    return {
      ...blocked(plan, error.code, error.message, error.retryable),
      recoveryPlan: ["Keep local integrity blocked.", "Run a new dry-run before retrying apply."],
    };
  }

  if (isProviderIssueLookupError(error)) {
    if (error.code === PROVIDER_ISSUE_LOOKUP_ERROR.RATE_LIMITED) {
      return {
        ...blocked(plan, ISSUE_REPAIR_ERROR.PROVIDER_RATE_LIMITED, error.message, true),
        recoveryPlan: ["Wait for provider quota reset.", "Run a new dry-run before retrying apply."],
      };
    }

    if (error.code === PROVIDER_ISSUE_LOOKUP_ERROR.UNAUTHORIZED || error.code === PROVIDER_ISSUE_LOOKUP_ERROR.FORBIDDEN) {
      return blocked(plan, ISSUE_REPAIR_ERROR.PROVIDER_FORBIDDEN, error.message, false);
    }

    if (error.code === PROVIDER_ISSUE_LOOKUP_ERROR.TRANSIENT) {
      return blocked(plan, ISSUE_REPAIR_ERROR.PROVIDER_TRANSIENT_ERROR, error.message, true);
    }
  }

  return {
    ...blocked(plan, ISSUE_REPAIR_ERROR.REPAIR_APPLY_FAILED, error instanceof Error ? error.message : String(error), true),
    recoveryPlan: ["Keep local integrity blocked.", "Inspect provider state and run a new dry-run."],
  };
}

/** Construct a typed repair failure. */
export function repairFailure(code: IssueRepairErrorCode, message: string, retryable = false): IssueRepairFailure {
  return new IssueRepairFailure(code, message, retryable);
}
