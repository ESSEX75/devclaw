/** Typed approval failures owned by setup orchestration. */

import type { ScopeApprovalRejectedDetails,ScopeApprovalRequiredDetails } from "./types.js";

/** Stops setup until the operator approves the identified gateway request. */
export class ScopeApprovalRequiredError extends Error {
  /** Gateway request the operator must approve. */
  readonly requestId: string;
  /** Complete DevClaw permission set. */
  readonly requiredScopes: string[];
  /** Permissions awaiting approval. */
  readonly missingScopes: string[];

  /** Capture the pending request for CLI and tool adapters.
   * @param args - Gateway request and required permission details.
   */
  constructor(args: ScopeApprovalRequiredDetails) {
    super(
      `OpenClaw scope approval required: ${args.missingScopes.join(", ")}. ` +
        `Approve request ${args.requestId}, then run setup again.`,
    );
    this.name = "ScopeApprovalRequiredError";
    this.requestId = args.requestId;
    this.requiredScopes = args.requiredScopes;
    this.missingScopes = args.missingScopes;
  }
}

/** Stops setup after an explicit gateway refusal or expired request. */
export class ScopeApprovalRejectedError extends Error {
  /** Gateway refusal or expiration outcome. */
  readonly status: ScopeApprovalRejectedDetails["status"];
  /** Gateway request identifier if known. */
  readonly requestId?: string;

  /** Capture refusal details for adapter diagnostics.
   * @param args - Gateway rejection outcome and optional request identifier.
   */
  constructor(args: ScopeApprovalRejectedDetails) {
    super(
      args.requestId
        ? `OpenClaw scope request ${args.requestId} was ${args.status}.`
        : `OpenClaw scope request was ${args.status}.`,
    );
    this.name = "ScopeApprovalRejectedError";
    this.status = args.status;
    this.requestId = args.requestId;
  }
}
