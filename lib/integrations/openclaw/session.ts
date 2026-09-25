/**
 * session.ts — Session management helpers for dispatch.
 */
import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import type { ResolvedTimeouts } from "../../state/index.js";
import { fetchGatewaySessions } from "./gateway-sessions.js";
import type { AgentTurnInput, AgentTurnOutcome } from "./types.js";

// ---------------------------------------------------------------------------
// Context budget management
// ---------------------------------------------------------------------------

/**
 * Determine whether a session should be cleared based on context budget.
 *
 * Rules:
 * - If same issue (feedback cycle), keep session — worker needs prior context
 * - If context ratio exceeds sessionContextBudget, clear
 */
export async function shouldClearSession(
  sessionKey: string,
  slotIssueId: number | null,
  newIssueId: number,
  timeouts: ResolvedTimeouts,
  workspaceDir: string,
  projectName: string,
  runCommand: RunCommand,
): Promise<boolean> {
  // Don't clear if re-dispatching for the same issue (feedback cycle)
  if (slotIssueId === newIssueId) {
    return false;
  }

  // Check context budget via gateway session data
  try {
    const sessions = await fetchGatewaySessions(undefined, runCommand);

    if (!sessions) return false; // Gateway unavailable — don't clear

    const session = sessions.get(sessionKey);

    if (!session) return false; // Session not found — will be spawned fresh anyway

    const ratio = session.percentUsed / 100;

    if (ratio > timeouts.sessionContextBudget) {
      await auditLog(workspaceDir, "session_budget_reset", {
        project: projectName,
        sessionKey,
        reason: "context_budget",
        percentUsed: session.percentUsed,
        threshold: timeouts.sessionContextBudget * 100,
        totalTokens: session.totalTokens,
        contextTokens: session.contextTokens,
      });

      return true;
    }
  } catch {
    // Gateway query failed — don't clear, let dispatch proceed normally
  }

  return false;
}

// ---------------------------------------------------------------------------
// Private helpers — exist so dispatchTask reads as a sequence of steps
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget session creation/update.
 * Session key is deterministic, so we don't need to wait for confirmation.
 * If this fails, health check will catch orphaned state later.
 */
export function ensureSessionFireAndForget(sessionKey: string, model: string, workspaceDir: string, runCommand: RunCommand, timeoutMs = 30_000, label?: string): void {
  const rc = runCommand;
  const params: Record<string, unknown> = { key: sessionKey, model };

  if (label) params.label = label;
  rc(
    ["openclaw", "gateway", "call", "sessions.patch", "--params", JSON.stringify(params)],
    { timeoutMs },
  ).catch((err) => {
    auditLog(workspaceDir, "dispatch_warning", {
      step: "ensureSession", sessionKey,
      error: (err as Error).message ?? String(err),
    }).catch(() => { });
  });
}

export function sendToAgent(
  sessionKey: string, taskMessage: string,
  opts: AgentTurnInput,
): void {
  // Fire-and-forget: long-running agent turn, don't await
  opts.runCommand(
    agentCommand(sessionKey, taskMessage, opts),
    { timeoutMs: opts.dispatchTimeoutMs ?? 600_000 },
  ).catch((err) => {
    auditLog(opts.workspaceDir, "dispatch_warning", {
      step: "sendToAgent", sessionKey,
      issue: opts.issueId, role: opts.role,
      error: (err as Error).message ?? String(err),
    }).catch(() => { });
  });
}

/**
 * Observe the gateway command result without interpreting transport failure as rejection.
 * Only local input validation proves that the command was never submitted.
 * @param sessionKey - Deterministic worker session identity.
 * @param taskMessage - Complete task context to submit.
 * @param opts - Gateway address, idempotency, and command capability.
 */
export async function submitAgentTurn(sessionKey: string, taskMessage: string, opts: AgentTurnInput): Promise<AgentTurnOutcome> {
  if (!sessionKey.trim() || !taskMessage.trim() || (opts.agentId !== undefined && !opts.agentId.trim())) {
    return { kind: "rejected", reason: "Gateway worker turn has invalid local submission input." };
  }

  try {
    const result = await opts.runCommand(agentCommand(sessionKey, taskMessage, opts), {
      timeoutMs: opts.dispatchTimeoutMs ?? 600_000,
    });

    if (result.termination !== "exit" || result.killed) {
      return { kind: "unknown", reason: `Gateway command ended without an exit response: ${result.termination}` };
    }

    if (result.code !== 0) {
      return { kind: "unknown", reason: `Gateway command failed after submission (exit ${result.code}): ${result.stderr}` };
    }

    return { kind: "accepted" };
  } catch (error) {
    return { kind: "unknown", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Build the shared gateway RPC with a stable key so a replay addresses one turn.
 * @param sessionKey - Deterministic worker session identity.
 * @param taskMessage - Complete task context to submit.
 * @param opts - Issue and parent session identity for the RPC.
 */
function agentCommand(sessionKey: string, taskMessage: string, opts: AgentTurnInput): string[] {
  const gatewayParams = JSON.stringify({
    idempotencyKey: `devclaw-${opts.projectName}-${opts.issueId}-${opts.role}-${opts.level ?? "unknown"}-${opts.slotIndex ?? 0}-${opts.fromLabel ?? "unknown"}-${sessionKey}`,
    agentId: opts.agentId ?? "devclaw",
    sessionKey,
    message: taskMessage,
    deliver: false,
    lane: "subagent",
    ...(opts.orchestratorSessionKey ? { spawnedBy: opts.orchestratorSessionKey } : {}),
    ...(opts.extraSystemPrompt ? { extraSystemPrompt: opts.extraSystemPrompt } : {}),
  });

  return ["openclaw", "gateway", "call", "agent", "--params", gatewayParams, "--expect-final", "--json"];
}
