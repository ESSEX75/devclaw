/** Owns GitHub repository operations and their provider-specific API semantics. */

import { classifyProviderLookupFailure } from "../lookup-errors.js";
import type {
  ProviderTransport,
} from "../types.js";
import { GhRepositorySchema } from "./schema.js";
import type {
  GitHubRepositoryInfo,
} from "./types.js";

/** Implements the repository capability using dependencies shared by one adapter instance. */
export class GitHubRepository {
  /** Successful repository identity cache; rejected reads never populate it. */
  private repoInfo: GitHubRepositoryInfo | undefined;
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   */
  constructor(private readonly transport: ProviderTransport) {}

  /** Cache only confirmed repository identity; failures leave future observations recoverable. */
  async getRepoInfo(): Promise<GitHubRepositoryInfo> {
    if (this.repoInfo !== undefined) return this.repoInfo;
    try {
      const raw: unknown = JSON.parse(await this.transport.read(["repo", "view", "--json", "owner,name"]));
      const data = GhRepositorySchema.parse(raw);

      this.repoInfo = { owner: data.owner.login, name: data.name };

      return this.repoInfo;
    } catch (error) {
      throw classifyProviderLookupFailure("github", error);
    }
  }
}
