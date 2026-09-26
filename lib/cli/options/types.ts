/** Terminal setup option and agent display contracts. */
import type { SetupNotificationChannel } from "../../application/setup/index.js";
import type { ExecutionMode } from "../../domain/index.js";

/** Parsed terminal setup flags before application validation. */
export type SetupCliOptions = {
  /** Display name requested for a new agent. */
  newAgent?: string;
  /** Selected existing agent identifier. */
  agent?: string;
  /** Explicit workspace target. */
  workspace?: string;
  /** Selected notification transport. */
  channelBinding?: SetupNotificationChannel | "none";
  /** Exact channel account identifier. */
  channelAccountId?: string;
  /** Exact group or topic destination. */
  channelPeerId?: string;
  /** Whether missing defaults should be created. */
  ejectDefaults?: boolean;
  /** Whether defaults should be replaced with backups. */
  resetDefaults?: boolean;
  /** Whether system instructions should be replaced with backups. */
  refreshInstructions?: boolean;
  /** Requested project scheduling mode. */
  projectExecution?: ExecutionMode;
  /** Whether to preview without effects. */
  dryRun?: boolean;
  [key: string]: string | boolean | undefined;
};

/** Read-only agent identity displayed by terminal prompts. */
export type ConfiguredAgent = {
  /** Stable configured agent identifier. */
  id: string;
  /** Optional human-readable agent name. */
  name?: string;
  /** Explicit workspace target. */
  workspace?: string;
};
