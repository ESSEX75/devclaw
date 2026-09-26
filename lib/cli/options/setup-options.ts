/** Normalizes terminal choices and formats read-only agent configuration. */

import {
  isSetupNotificationChannel,
  type SetupNotificationChannel,
  type SetupRuntime,
} from "../../application/setup/index.js";
import { EXECUTION_MODE, type ExecutionMode } from "../../domain/index.js";
import type { ConfiguredAgent, SetupCliOptions } from "./types.js";

/** Read the configured default workspace for terminal target selection.
 * @param runtime - Read-only configuration source.
 */
export function getDefaultWorkspaceDir(runtime: SetupRuntime): string | undefined {
  try {
    const config = runtime.config.current();

    return config.agents?.defaults?.workspace ?? undefined;
  } catch {
    return undefined;
  }
}

/** Read configured agents for the interactive target menu.
 * @param runtime - Read-only configuration source.
 */
export function getConfiguredAgents(runtime: SetupRuntime): readonly ConfiguredAgent[] {
  try {
    const config = runtime.config.current();

    return config.agents?.list ?? [];
  } catch {
    return [];
  }
}

/** Format an agent choice without changing its identifier.
 * @param agent - Configured agent to display.
 */
export function formatAgentLabel(agent: ConfiguredAgent): string {
  return agent.name && agent.name !== agent.id ? `${agent.name} (${agent.id})` : agent.id;
}

/** Format the selected exact destination for terminal output.
 * @param opts - Selected channel, account, and peer options.
 */
export function formatSelectedChannelBinding(opts: Pick<SetupCliOptions, "channelBinding" | "channelAccountId" | "channelPeerId">): string {
  if (!opts.channelBinding || opts.channelBinding === "none") return "none";
  const account = opts.channelAccountId?.trim() || "missing-account";

  return opts.channelPeerId?.trim()
    ? `${opts.channelBinding}/${account}/${opts.channelPeerId.trim()}`
    : `${opts.channelBinding}/${account}`;
}

/** Convert the explicit none selection and validate channel membership.
 * @param value - Parsed terminal channel option.
 */
export function normalizeChannelBinding(
  value: SetupCliOptions["channelBinding"],
): SetupNotificationChannel | null | undefined {
  if (value === undefined) return undefined;
  if (value === "none") return null;
  if (isSetupNotificationChannel(value)) return value;
  throw new Error(`Invalid channel binding: ${value}. Use telegram, whatsapp, or none.`);
}

/** Validate the terminal execution-mode option.
 * @param value - Parsed execution-mode selection.
 */
export function normalizeProjectExecution(value: SetupCliOptions["projectExecution"]): ExecutionMode | undefined {
  if (value === undefined) return undefined;
  if (value === EXECUTION_MODE.PARALLEL || value === EXECUTION_MODE.SEQUENTIAL) return value;
  throw new Error(`Invalid project execution mode: ${value}. Use parallel or sequential.`);
}
