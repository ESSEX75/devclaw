/** Composes a concrete provider from explicit selection or verified known-host detection. */

import { ISSUE_PROVIDER } from "../../domain/index.js";
import { resolveRepoPath } from "../../state/index.js";
import { detectProvider } from "./detection.js";
import { GitHubProvider } from "./github/index.js";
import { GitLabProvider } from "./gitlab/index.js";
import type { ProviderOptions, ProviderWithType } from "./types.js";

/** Create a provider using explicit selection or confirmed known-host detection.
 * @param opts - Repository, runtime command capability and optional explicit provider selection.
 */
export async function createProvider(opts: ProviderOptions): Promise<ProviderWithType> {
  const repoPath = opts.repoPath ?? (opts.repo ? resolveRepoPath(opts.repo) : null);

  if (!repoPath) throw new Error("Either repoPath or repo must be provided");
  const runCommand = opts.runCommand;
  const type = opts.provider ?? await detectProvider(repoPath, runCommand);
  const provider = type === ISSUE_PROVIDER.GITHUB
    ? new GitHubProvider({ repoPath, runCommand })
    : new GitLabProvider({ repoPath, runCommand });

  return { provider, type };
}
