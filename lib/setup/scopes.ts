/**
 * scopes.ts — OpenClaw scope preflight for DevClaw setup entrypoints.
 *
 * DevClaw worker dispatch uses gateway session APIs. The setup core does not
 * depend on this module; CLI/tool wrappers call it before runSetup so missing
 * OpenClaw permissions can surface as a pending approval request without
 * mixing approval transport into config/workspace orchestration.
 */
import type { RunCommand } from "../context.js";

export const REQUIRED_OPENCLAW_SCOPES = [
  "operator.read",
  "operator.write",
] as const;

export type OpenClawScope = typeof REQUIRED_OPENCLAW_SCOPES[number];

type ScopeCommandStatus =
  | "approved"
  | "missing_scopes"
  | "pending_approval"
  | "denied"
  | "expired";

export type ScopeCommandResult = {
  ok?: boolean;
  status?: ScopeCommandStatus | string;
  approved?: string[];
  missing?: string[];
  requestId?: string;
  message?: string;
};

export type ScopePreflightResult = {
  status: "approved" | "unavailable";
  approved: string[];
  missing: string[];
  warning?: string;
};

export class ScopeApprovalRequiredError extends Error {
  readonly requestId: string;
  readonly requiredScopes: string[];
  readonly missingScopes: string[];

  constructor(args: { requestId: string; requiredScopes: string[]; missingScopes: string[] }) {
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

export class ScopeApprovalRejectedError extends Error {
  readonly status: "denied" | "expired";
  readonly requestId?: string;

  constructor(args: { status: "denied" | "expired"; requestId?: string }) {
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

export function isScopeApprovalRequiredError(err: unknown): err is ScopeApprovalRequiredError {
  return err instanceof ScopeApprovalRequiredError;
}

export function isScopeApprovalRejectedError(err: unknown): err is ScopeApprovalRejectedError {
  return err instanceof ScopeApprovalRejectedError;
}

export async function ensureRequiredOpenClawScopes(runCommand: RunCommand): Promise<ScopePreflightResult> {
  const check = await runScopesCommand(runCommand, [
    "openclaw",
    "scopes",
    "check",
    ...scopeArgs(REQUIRED_OPENCLAW_SCOPES),
    "--json",
  ]);

  if (!check.supported) {
    return {
      status: "unavailable",
      approved: [],
      missing: [...REQUIRED_OPENCLAW_SCOPES],
      warning:
        "OpenClaw scopes CLI is unavailable. Upgrade OpenClaw to use deterministic DevClaw scope preflight.",
    };
  }

  const missing = normalizeMissing(check.result);
  if (isApproved(check.result, missing)) {
    return {
      status: "approved",
      approved: check.result.approved ?? [...REQUIRED_OPENCLAW_SCOPES],
      missing: [],
    };
  }

  const request = await runScopesCommand(runCommand, [
    "openclaw",
    "scopes",
    "request",
    ...scopeArgs(missing.length > 0 ? missing : REQUIRED_OPENCLAW_SCOPES),
    "--reason",
    "devclaw-worker-dispatch",
    "--json",
  ]);

  if (!request.supported) {
    return {
      status: "unavailable",
      approved: [],
      missing,
      warning:
        "OpenClaw scopes request CLI is unavailable. Upgrade OpenClaw before relying on DevClaw worker dispatch preflight.",
    };
  }

  const status = request.result.status;
  if (status === "approved" || request.result.ok === true) {
    return {
      status: "approved",
      approved: request.result.approved ?? [...REQUIRED_OPENCLAW_SCOPES],
      missing: [],
    };
  }

  if (status === "denied" || status === "expired") {
    throw new ScopeApprovalRejectedError({
      status,
      requestId: request.result.requestId,
    });
  }

  if (status === "pending_approval" && request.result.requestId) {
    throw new ScopeApprovalRequiredError({
      requestId: request.result.requestId,
      requiredScopes: [...REQUIRED_OPENCLAW_SCOPES],
      missingScopes: request.result.missing ?? missing,
    });
  }

  throw new Error(`Unexpected OpenClaw scopes response: ${JSON.stringify(request.result)}`);
}

function scopeArgs(scopes: readonly string[]): string[] {
  return scopes.flatMap((scope) => ["--scope", scope]);
}

function isApproved(result: ScopeCommandResult, missing: string[]): boolean {
  return result.ok === true || result.status === "approved" || missing.length === 0;
}

function normalizeMissing(result: ScopeCommandResult): string[] {
  if (Array.isArray(result.missing)) return result.missing;
  const approved = new Set(result.approved ?? []);
  return REQUIRED_OPENCLAW_SCOPES.filter((scope) => !approved.has(scope));
}

async function runScopesCommand(
  runCommand: RunCommand,
  argv: string[],
): Promise<{ supported: true; result: ScopeCommandResult } | { supported: false }> {
  const proc = await runCommand(argv, { timeoutMs: 30_000 });
  const stdout = String(proc.stdout ?? "").trim();
  const stderr = String(proc.stderr ?? "").trim();

  if (proc.code !== 0) {
    if (isUnsupportedScopesCli(stdout, stderr)) return { supported: false };
    throw new Error(stderr || stdout || `Command failed: ${argv.join(" ")}`);
  }

  try {
    return { supported: true, result: JSON.parse(stdout) as ScopeCommandResult };
  } catch {
    throw new Error(`Invalid JSON from OpenClaw scopes command: ${stdout || "<empty>"}`);
  }
}

function isUnsupportedScopesCli(stdout: string, stderr: string): boolean {
  const text = `${stdout}\n${stderr}`.toLowerCase();
  return (
    text.includes("unknown command") ||
    text.includes("invalid command") ||
    text.includes("unknown option") ||
    text.includes("not found")
  );
}
