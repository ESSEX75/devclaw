/** Owns the gateway protocol for removing a stale worker session before submission. */

import type { RunCommand } from "../../../context.js";
import { isCompletedCommand } from "../../process/index.js";
import { GATEWAY_COMMAND, SESSION_DELETE_METHOD, SESSION_DELETE_TIMEOUT_MS } from "./const.js";

/** Delete the selected session once; missing identity and abnormal completion are explicit failures.
 * Application decides whether cleanup failure blocks dispatch; no default session is guessed.
 * @param sessionKey - Exact session selected for replacement.
 * @param runCommand - OpenClaw CLI execution capability.
 */
export async function deleteWorkerSession(sessionKey: string, runCommand: RunCommand): Promise<void> {
  if (!sessionKey.trim()) throw new Error("Session cleanup requires a nonempty exact session key.");
  const result = await runCommand([...GATEWAY_COMMAND, SESSION_DELETE_METHOD, "--params", JSON.stringify({ key: sessionKey })],
    { timeoutMs: SESSION_DELETE_TIMEOUT_MS });

  if (!isCompletedCommand(result) || result.code !== 0) {
    throw new Error(`Session cleanup failed: ${result.stderr || result.stdout || result.termination}`);
  }
}
