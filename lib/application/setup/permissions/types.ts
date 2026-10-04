/** Contracts owned by setup permissions. */

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import type { SCOPE_STATUS } from "../../../integrations/openclaw/scopes/index.js";
import type { ValueOf } from "../../../types.js";
import type { SCOPE_PREFLIGHT_STATUS } from "./const.js";

/** Nonblocking permission preflight outcome. */
export type ScopePreflightResult = {
  /** Reported transport or preflight status. */
  status: ValueOf<typeof SCOPE_PREFLIGHT_STATUS>;
  /** Permissions confirmed by the gateway. */
  approved: string[];
  /** Permissions not yet granted. */
  missing: string[];
  /** Nonfatal transport availability diagnostic. */
  warning?: string;
};

/** SDK-owned per-agent tool policy, preserved when extending DevClaw permissions. */
export type AgentToolPolicy = NonNullable<NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]>[number]["tools"]>;

/** Approval request details surfaced to setup adapters. */
export type ScopeApprovalRequiredDetails = {
  /** Gateway approval request identifier. */
  requestId: string;
  /** Complete permissions required by DevClaw. */
  requiredScopes: string[];
  /** Permissions awaiting approval. */
  missingScopes: string[];
};

/** Explicit refusal or expiration of an approval request. */
export type ScopeApprovalRejectedDetails = {
  /** Nonrecoverable outcome for this request. */
  status: typeof SCOPE_STATUS.DENIED | typeof SCOPE_STATUS.EXPIRED;
  /** Gateway request identifier when supplied. */
  requestId?: string;
};
