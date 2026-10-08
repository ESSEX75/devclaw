/** Coordinates setup scope approval using validated integration outcomes. */

import type { RunCommand } from "../../../context.js";
import { runScopeCommand, SCOPE_STATUS, type ScopeCommandResult } from "../../../integrations/index.js";
import { REQUIRED_OPENCLAW_SCOPES, SCOPE_APPROVAL_REASON, SCOPE_PREFLIGHT_STATUS } from "./const.js";
import { ScopeApprovalRejectedError, ScopeApprovalRequiredError } from "./errors.js";
import type { ScopePreflightResult } from "./types.js";

/** Check approval before setup writes, requesting only missing permissions.
 * An unavailable CLI remains a warning; operational errors and rejection stop setup.
 * @param runCommand - Runtime-owned command transport.
 */
export async function ensureRequiredOpenClawScopes(runCommand: RunCommand): Promise<ScopePreflightResult> {
  const check = await runScopeCommand(runCommand, REQUIRED_OPENCLAW_SCOPES);

  if (!check.supported) return unavailable([...REQUIRED_OPENCLAW_SCOPES]);
  const missing = missingScopes(check.result);

  assertNotRejectedOrPending(check.result, missing);
  if (isApproved(check.result, missing)) return approved(check.result);
  if (check.result.ok === true || check.result.status === SCOPE_STATUS.APPROVED
    || (check.result.status !== SCOPE_STATUS.MISSING && !check.result.missing?.length)) {
    throw new Error(`Unexpected OpenClaw scopes response: ${JSON.stringify(check.result)}`);
  }

  if (!missing.length) throw new Error("OpenClaw reported missing scopes without identifying required permissions.");
  const request = await runScopeCommand(runCommand, missing, SCOPE_APPROVAL_REASON);

  if (!request.supported) return unavailable(missing);
  const confirmedBeforeRequest = REQUIRED_OPENCLAW_SCOPES.filter(scope => !missing.includes(scope));
  const requestResult = {
    ...request.result,
    ...(request.result.approved === undefined ? {} : { approved: [...new Set([...confirmedBeforeRequest, ...request.result.approved])] }),
  };
  const requestMissing = missingScopes(requestResult);

  assertNotRejectedOrPending(requestResult, requestMissing);
  if (isApproved(requestResult, requestMissing)) return approved(requestResult);
  throw new Error(`Unexpected OpenClaw scopes response: ${JSON.stringify(request.result)}`);
}

/** Explicit denial and pending approval take precedence over contradictory success fields.
 * @param result - Validated CLI payload.
 * @param missing - Required permissions not proven approved.
 */
function assertNotRejectedOrPending(result: ScopeCommandResult, missing: string[]): void {
  if (result.status === SCOPE_STATUS.DENIED || result.status === SCOPE_STATUS.EXPIRED) {
    throw new ScopeApprovalRejectedError({ status: result.status, requestId: result.requestId });
  }

  if (result.status === SCOPE_STATUS.PENDING) {
    if (!result.requestId?.trim()) throw new Error("Pending OpenClaw approval has no request identifier.");
    throw new ScopeApprovalRequiredError({
      requestId: result.requestId,
      requiredScopes: [...REQUIRED_OPENCLAW_SCOPES],
      missingScopes: missing.length ? missing : [...REQUIRED_OPENCLAW_SCOPES],
    });
  }
}

/** Require consistent positive evidence for every required permission.
 * @param result - CLI status and optional permission lists.
 * @param missing - Required permissions lacking approval evidence.
 */
function isApproved(result: ScopeCommandResult, missing: string[]): boolean {
  if (result.status !== undefined && result.status !== SCOPE_STATUS.APPROVED) return false;
  if (result.ok === false || result.missing?.length || (result.approved !== undefined && missing.length)) return false;

  return result.status === SCOPE_STATUS.APPROVED || result.ok === true || (result.approved !== undefined && !missing.length);
}

/** Combine negative and positive lists so an empty missing list cannot erase an omission.
 * @param result - CLI payload whose permission evidence is being checked.
 */
function missingScopes(result: ScopeCommandResult): string[] {
  return REQUIRED_OPENCLAW_SCOPES.filter(scope => result.missing?.includes(scope)
    || (result.approved !== undefined ? !result.approved.includes(scope) : result.missing === undefined));
}

/** Render the confirmed scope outcome.
 * @param result - Consistent positive CLI evidence.
 */
function approved(result: ScopeCommandResult): ScopePreflightResult {
  return { status: SCOPE_PREFLIGHT_STATUS.APPROVED, approved: result.approved ?? [...REQUIRED_OPENCLAW_SCOPES], missing: [] };
}

/** Preserve the optional preflight contract for runtimes without this CLI capability.
 * @param missing - Required scopes whose approval could not be checked.
 */
function unavailable(missing: string[]): ScopePreflightResult {
  return { status: SCOPE_PREFLIGHT_STATUS.UNAVAILABLE, approved: [], missing,
    warning: "OpenClaw scopes CLI is unavailable. Upgrade OpenClaw to use deterministic DevClaw scope preflight." };
}
