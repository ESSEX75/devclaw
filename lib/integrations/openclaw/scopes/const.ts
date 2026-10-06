/** Protocol identifiers for the optional OpenClaw scope approval CLI. */

/** Scope response states understood by approval orchestration. */
export const SCOPE_STATUS = {
  APPROVED: "approved", MISSING: "missing_scopes", PENDING: "pending_approval", DENIED: "denied", EXPIRED: "expired",
} as const;

/** Supported CLI operations. */
export const SCOPE_COMMAND = { CHECK: "check", REQUEST: "request" } as const;

/** External executable responsible for scope approval. */
export const OPENCLAW_EXECUTABLE = "openclaw";

/** CLI subcommand and option identifiers. */
export const SCOPE_CLI = { ROOT: "scopes", SCOPE: "--scope", REASON: "--reason", JSON: "--json" } as const;

/** Bound command execution without starting a long-lived approval wait. */
export const SCOPE_COMMAND_TIMEOUT_MS = 30_000;

/** Recognize only absent scope CLI capabilities, never generic operational failures. */
export const UNSUPPORTED_SCOPE_CLI = /(?:unknown|invalid) command ['"]?(?:scopes|check|request)['"]?(?:[.\s]|$)|unknown option ['"]?--scope['"]?(?:[.\s]|$)/i;
