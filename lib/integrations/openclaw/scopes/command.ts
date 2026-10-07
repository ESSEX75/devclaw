/** Executes and validates the optional OpenClaw scopes CLI; owns no approval policy. */

import type { RunCommand } from "../../../context.js";
import { isCompleteCommandOutput,isCompletedCommand } from "../../process/index.js";
import { OPENCLAW_EXECUTABLE, SCOPE_CLI, SCOPE_COMMAND, SCOPE_COMMAND_TIMEOUT_MS, UNSUPPORTED_SCOPE_CLI } from "./const.js";
import { scopeCommandSchema } from "./schema.js";
import type { ScopeCommandOutcome } from "./types.js";

/** Invoke a check, or request when an approval reason is supplied.
 * Nonzero operational failures and malformed JSON throw; absent CLI support is explicit.
 * @param runCommand - Runtime-owned process transport.
 * @param scopes - Exact permissions to check or request.
 * @param reason - Approval justification; omission selects the read-only check.
 */
export async function runScopeCommand(runCommand: RunCommand, scopes: readonly string[], reason?: string): Promise<ScopeCommandOutcome> {
  const argv = [OPENCLAW_EXECUTABLE, SCOPE_CLI.ROOT, reason === undefined ? SCOPE_COMMAND.CHECK : SCOPE_COMMAND.REQUEST,
    ...scopes.flatMap(scope => [SCOPE_CLI.SCOPE, scope]),
    ...(reason === undefined ? [] : [SCOPE_CLI.REASON, reason]), SCOPE_CLI.JSON];
  const proc = await runCommand(argv, { timeoutMs: SCOPE_COMMAND_TIMEOUT_MS });
  const stdout = proc.stdout.trim();
  const stderr = proc.stderr.trim();

  if (!isCompletedCommand(proc) || !isCompleteCommandOutput(proc)) {
    throw new Error(`OpenClaw scopes command ended without clean completion (${proc.termination}, signal ${proc.signal}).`);
  }

  if (proc.code !== 0) {
    if (UNSUPPORTED_SCOPE_CLI.test(`${stdout}\n${stderr}`)) return { supported: false };
    throw new Error(stderr || stdout || `Command failed: ${argv.join(" ")}`);
  }

  try {
    const response: unknown = JSON.parse(stdout);

    return { supported: true, result: scopeCommandSchema.parse(response) };
  } catch {
    throw new Error(`Invalid JSON from OpenClaw scopes command: ${stdout || "<empty>"}`);
  }
}
