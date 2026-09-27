/** Owns the gateway protocol for removing a stale worker session before submission. */

import type { RunCommand } from "../../context.js";
import { SESSION_DELETE_METHOD, SESSION_DELETE_TIMEOUT_MS } from "./const.js";

/** Delete the selected stale session; callers decide whether cleanup failure blocks dispatch.
 * @param sessionKey - Exact session selected for replacement.
 * @param runCommand - OpenClaw CLI execution capability.
 */
export async function deleteWorkerSession(sessionKey: string, runCommand: RunCommand): Promise<void> {
  const result = await runCommand(["openclaw", "gateway", "call", SESSION_DELETE_METHOD, "--params", JSON.stringify({ key: sessionKey })],
    { timeoutMs: SESSION_DELETE_TIMEOUT_MS });

  if (result.code !== 0) throw new Error(`Session cleanup failed: ${result.stderr || result.stdout}`);
}
