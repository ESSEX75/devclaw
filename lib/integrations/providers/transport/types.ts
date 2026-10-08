/** Owns command dependencies and the checked transport contract shared by concrete adapters. */

import type { z } from "zod";

import type { RunCommand } from "../../../context.js";
import type { ValueOf } from "../../../types.js";
import type { PROVIDER_CLI, PROVIDER_COMMAND_MODE } from "./const.js";

/** Replay safety explicitly selected for a provider CLI operation. */
export type ProviderCommandMode = ValueOf<typeof PROVIDER_COMMAND_MODE>;

/** Repository dependencies shared by every concrete capability. */
export type ProviderAdapterOptions = {
  /** Repository supplying CLI host/configuration context. */
  repoPath: string;
  /** Plugin-owned process transport. */
  runCommand: RunCommand;
};

/** Instance-owned transport consumed by concrete capability implementations. */
export interface ProviderTransport {
  /** Repository supplying host and CLI context. */
  readonly repoPath: string;
  /** Plugin-owned transport also used for native git and multipart commands. */
  readonly runCommand: RunCommand;
  /** Read with classified retries.
   * @param args - Read-only arguments.
   */
  read(args: string[]): Promise<string>;
  /** Apply an explicitly idempotent state setter.
   * @param args - Desired-state mutation arguments.
   */
  write(args: string[]): Promise<string>;
  /** Submit exactly once.
   * @param args - Non-replayable mutation arguments.
   */
  once(args: string[]): Promise<string>;
  /** Validate every item across complete CLI-managed pages.
   * @param endpoint - Collection endpoint and optional filters.
   * @param schema - Owning provider record schema.
   */
  collection<T>(endpoint: string, schema: z.ZodType<T>): Promise<T[]>;
}

/** Concrete CLI identity derived from the canonical registry. */
export type ProviderCli = ValueOf<typeof PROVIDER_CLI>;
