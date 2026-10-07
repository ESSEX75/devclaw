/** Shares physical command evidence without imposing provider retry or application recovery policy. */

import type { RunCommand } from "../../context.js";
import type { COMMAND_EXIT_TERMINATION } from "./const.js";

/** Process evidence returned by the plugin-owned transport. */
export type CommandResult = Awaited<ReturnType<RunCommand>>;

/** A normal observed exit; the numeric exit code still determines operation success or failure. */
export type CompletedCommandResult = CommandResult & {
  /** Integer exit code observed after normal completion. */
  code: number;
  /** A signal cannot provide clean command completion evidence. */
  signal: null;
  /** The transport did not kill the command. */
  killed: false;
  /** Observed normal process exit. */
  termination: typeof COMMAND_EXIT_TERMINATION;
};

/** Captured output can be interpreted only when the transport reports no clipping or stream error. */
export type CompleteCommandOutput = CommandResult & {
  /** Full stdout capture, or no reported capture loss. */
  stdoutTruncatedBytes?: 0;
  /** Full stderr capture needed for reliable failure classification. */
  stderrTruncatedBytes?: 0;
  /** Neither output stream reported a capture error. */
  outputErrorStream?: undefined;
};
