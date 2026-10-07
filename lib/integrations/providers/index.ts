/**
 * Provider factory — auto-detects GitHub vs GitLab from git remote.
 */

import { ISSUE_PROVIDER, type IssueProviderId, type WorkflowConfig } from "../../domain/index.js";

export type * from "./capabilities.js";
export { PR_COMMENT_KIND, PROVIDER_ISSUE_STATE, PROVIDER_REVIEW_STATE } from "./const.js";
export * from "./lookup-errors.js";
export * from "./operation-errors.js";
export * from "./provider.js";
export * from "./types.js";
import type { RunCommand } from "../../context.js";
import { resolveRepoPath } from "../../state/index.js";
import { runProviderCommand } from "./command.js";
import { GITHUB_ORIGIN_HOSTS, GITLAB_ORIGIN_HOSTS, PROVIDER_TRANSPORT_POLICY } from "./const.js";
import { GitHubProvider } from "./github.js";
import { GitLabProvider } from "./gitlab.js";

export type ProviderOptions = {
  provider?: IssueProviderId;
  repo?: string;
  repoPath?: string;
  runCommand: RunCommand;
  workflow?: WorkflowConfig;
};

export type ProviderWithType = {
  provider: GitHubProvider | GitLabProvider;
  type: IssueProviderId;
};

/** Detect only known hosts; unknown/self-hosted repositories require an explicit provider.
 * @param repoPath - Repository containing the origin remote.
 * @param runCommand - Runtime-owned git transport.
 */
async function detectProvider(repoPath: string, runCommand: RunCommand): Promise<IssueProviderId> {
  const remote = await runProviderCommand(runCommand, ["git", "remote", "get-url", "origin"], repoPath, PROVIDER_TRANSPORT_POLICY.REMOTE_TIMEOUT_MS);
  let host: string;

  try {
    host = new URL(remote).hostname.toLowerCase();
  } catch {
    const scp = remote.match(/^[^@\s]+@([^:\s]+):.+$/);

    if (!scp) throw new Error("Cannot identify the origin host; specify the issue provider explicitly.");
    host = scp[1].toLowerCase();
  }

  if (GITHUB_ORIGIN_HOSTS.has(host)) return ISSUE_PROVIDER.GITHUB;
  if (GITLAB_ORIGIN_HOSTS.has(host)) return ISSUE_PROVIDER.GITLAB;

  throw new Error(`Unknown origin host "${host}"; specify the issue provider explicitly.`);
}

/** Create a provider using explicit selection or confirmed known-host detection.
 * @param opts - Repository, runtime command capability and optional provider/workflow selection.
 */
export async function createProvider(opts: ProviderOptions): Promise<ProviderWithType> {
  const repoPath = opts.repoPath ?? (opts.repo ? resolveRepoPath(opts.repo) : null);

  if (!repoPath) throw new Error("Either repoPath or repo must be provided");
  const rc = opts.runCommand;
  const type = opts.provider ?? await detectProvider(repoPath, rc);
  const provider = type === ISSUE_PROVIDER.GITHUB
    ? new GitHubProvider({ repoPath, runCommand: rc, workflow: opts.workflow })
    : new GitLabProvider({ repoPath, runCommand: rc, workflow: opts.workflow });

  return { provider, type };
}
