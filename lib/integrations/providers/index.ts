/**
 * Provider factory — auto-detects GitHub vs GitLab from git remote.
 */
import { ISSUE_PROVIDER, type IssueProvider } from "../../domain/index.js";

export type * from "./capabilities.js";
export * from "./provider.js";
export * from "./types.js";
import type { RunCommand } from "../../context.js";
import { resolveRepoPath } from "../../state/projects/index.js";
import { GitHubProvider } from "./github.js";
import { GitLabProvider } from "./gitlab.js";

export type ProviderOptions = {
  provider?: IssueProvider;
  repo?: string;
  repoPath?: string;
  runCommand: RunCommand;
};

export type ProviderWithType = {
  provider: GitHubProvider | GitLabProvider;
  type: IssueProvider;
};

async function detectProvider(repoPath: string, runCommand: RunCommand): Promise<IssueProvider> {
  try {
    const result = await runCommand(["git", "remote", "get-url", "origin"], { timeoutMs: 5_000, cwd: repoPath });

    return result.stdout.trim().includes("github.com")
      ? ISSUE_PROVIDER.GITHUB
      : ISSUE_PROVIDER.GITLAB;
  } catch {
    return ISSUE_PROVIDER.GITLAB;
  }
}

export async function createProvider(opts: ProviderOptions): Promise<ProviderWithType> {
  const repoPath = opts.repoPath ?? (opts.repo ? resolveRepoPath(opts.repo) : null);

  if (!repoPath) throw new Error("Either repoPath or repo must be provided");
  const rc = opts.runCommand;
  const type = opts.provider ?? await detectProvider(repoPath, rc);
  const provider = type === ISSUE_PROVIDER.GITHUB
    ? new GitHubProvider({ repoPath, runCommand: rc })
    : new GitLabProvider({ repoPath, runCommand: rc });

  return { provider, type };
}
