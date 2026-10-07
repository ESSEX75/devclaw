/** Validates physical command completion consistently before adapters interpret response or failure text. */

import { COMMAND_EXIT_TERMINATION } from "./const.js";
import type { CommandResult, CompleteCommandOutput,CompletedCommandResult } from "./types.js";

/** Establish only clean process completion; a nonzero exit remains an operation-specific failure.
 * @param result - Process evidence returned by the plugin transport.
 */
export function isCompletedCommand(result: CommandResult): result is CompletedCommandResult {
  return result.termination === COMMAND_EXIT_TERMINATION && result.killed === false && result.signal === null
    && result.code !== null && Number.isInteger(result.code);
}

/** Reject explicitly clipped output even if its surviving JSON or diagnostic looks valid.
 * This does not decide command acceptance when an adapter only needs exit evidence.
 * @param result - Capture metadata supplied by the plugin-owned process transport.
 */
export function isCompleteCommandOutput(result: CommandResult): result is CompleteCommandOutput {
  return (result.stdoutTruncatedBytes ?? 0) === 0 && (result.stderrTruncatedBytes ?? 0) === 0
    && result.outputErrorStream === undefined;
}
