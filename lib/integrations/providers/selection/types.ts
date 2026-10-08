/** Owns provider construction inputs and the selected adapter result. */

import type { RunCommand } from "../../../context.js";
import type { IssueProviderId } from "../../../domain/index.js";
import type { IssueProvider } from "../contracts/index.js";

/** Factory inputs; workflow selection belongs to application and is never interpreted by adapters. */
export type ProviderOptions = {
  /** Explicit provider, required for unknown or self-hosted hosts. */
  provider?: IssueProviderId;
  /** Repository path resolved by state when repoPath is absent. */
  repo?: string;
  /** Absolute repository context. */
  repoPath?: string;
  /** Plugin-owned process transport. */
  runCommand: RunCommand;
};

/** Selected provider exposed through its supported capability contract. */
export type ProviderWithType = {
  /** Composed provider facade. */
  provider: IssueProvider;
  /** Confirmed provider identity. */
  type: IssueProviderId;
};
