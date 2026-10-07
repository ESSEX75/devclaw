/** Resolves only known origin hosts; explicit provider selection owns self-hosted installations. */

import type { RunCommand } from "../../context.js";
import { ISSUE_PROVIDER, type IssueProviderId } from "../../domain/index.js";
import { runProviderCommand } from "./command.js";
import { GITHUB_ORIGIN_HOSTS, GITLAB_ORIGIN_HOSTS, PROVIDER_TRANSPORT_POLICY } from "./const.js";

/** Detect only known hosts; unknown/self-hosted repositories require an explicit provider.
 * @param repoPath - Repository containing the origin remote.
 * @param runCommand - Runtime-owned git transport.
 */
export async function detectProvider(repoPath: string, runCommand: RunCommand): Promise<IssueProviderId> {
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
