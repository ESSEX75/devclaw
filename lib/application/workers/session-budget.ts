/** Owns optional worker session budget reset decisions and audit; gateway observations never establish worker ownership. */

import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import { fetchGatewaySessions } from "../../integrations/openclaw/sessions/index.js";
import type { ResolvedTimeouts } from "../../state/index.js";
import { WORKER_AUDIT_EVENT } from "./const.js";

/**
 * Determine whether a session should be cleared based on context budget.
 *
 * Rules:
 * - If same issue (feedback cycle), keep session — worker needs prior context
 * - If context ratio exceeds sessionContextBudget, clear.
 * Unavailable metrics or exceptions from observation/audit retain the existing session. Audit
 * persistence follows the shared best-effort logger contract. This only selects
 * cleanup; dispatch owns execution, and session presence never establishes worker ownership.
 * @param sessionKey - Exact previously assigned worker session.
 * @param slotIssueId - Issue retained in the prior worker slot, or null for an empty slot.
 * @param newIssueId - Application-selected issue being dispatched.
 * @param timeouts - Resolved application policy containing the context budget ratio.
 * @param workspaceDir - Workspace receiving worker audit evidence.
 * @param projectName - Project identity included in the budget decision audit.
 * @param runCommand - Plugin transport used for read-only gateway observation.
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

    const session = sessions.sessions.get(sessionKey);

    if (!session || session.percentUsed === undefined) return false;

    const ratio = session.percentUsed / 100;

    if (ratio > timeouts.sessionContextBudget) {
      await auditLog(workspaceDir, WORKER_AUDIT_EVENT.SESSION_BUDGET_RESET, {
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
