/** Executes one CLI request and preserves abnormal process completion as unknown mutation evidence. */

import type { RunCommand } from "../../context.js";
import { PROVIDER_OPERATION_ERROR, PROVIDER_TRANSPORT_POLICY } from "./const.js";
import { normalizeProviderFailure, ProviderTransportError } from "./failures.js";

/** Execute once; callers select replay safety and supply any resilience policy outside this function.
 * @param runCommand - Plugin-owned process transport.
 * @param argv - Complete CLI argument vector; never included in diagnostics.
 * @param repoPath - Repository whose provider configuration supplies host and credentials.
 * @param timeoutMs - Maximum process observation time.
 */
export async function runProviderCommand(runCommand: RunCommand, argv: string[], repoPath: string,
  timeoutMs: number = PROVIDER_TRANSPORT_POLICY.TIMEOUT_MS): Promise<string> {
  let result: Awaited<ReturnType<RunCommand>>;

  try {
    result = await runCommand(argv, { timeoutMs, cwd: repoPath });
  } catch (error) {
    const failure = normalizeProviderFailure(error);

    throw new ProviderTransportError(error instanceof Error ? error.message : String(error), { ...failure, outcomeUnknown: true }, error);
  }

  if (result.termination !== "exit" || result.killed || result.signal !== null || result.code === null) {
    throw new ProviderTransportError(result.stderr?.trim() || `Provider command ended abnormally: ${result.termination}.`,
      { code: PROVIDER_OPERATION_ERROR.TRANSIENT, retryable: true, outcomeUnknown: true });
  }

  if (result.code !== 0) {
    const message = result.stderr?.trim() || `Provider command failed with exit code ${result.code}.`;

    throw new ProviderTransportError(message, normalizeProviderFailure(new Error(message)));
  }

  return result.stdout.trim();
}
