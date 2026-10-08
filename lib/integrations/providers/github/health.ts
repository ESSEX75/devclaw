/** Owns GitHub health operations and their provider-specific API semantics. */

import type { ProviderRateLimitStatus } from "../contracts/index.js";
import type { ProviderTransport } from "../transport/index.js";
import { parseProviderJson } from "../transport/index.js";
import { GhRateLimitSchema,GITHUB_EPOCH_SECOND_MS, GITHUB_HEALTH_QUERY } from "./health/index.js";

/** Implements the health capability using dependencies shared by one adapter instance. */
export class GitHubHealth {
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   */
  constructor(private readonly transport: ProviderTransport) {}

  /** Probe CLI authentication; unavailability is a failed health observation.
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.transport.read(["auth", "status"]);

      return true;
    } catch { return false; }
  }

  /** Read GitHub's current core API quota for repair mutation preflight. */
  async getRateLimitStatus(): Promise<ProviderRateLimitStatus> {
    const parsed = parseProviderJson(await this.transport.read(["api", GITHUB_HEALTH_QUERY.RATE_LIMIT]), GhRateLimitSchema);

    return {
      remaining: parsed.resources.core.remaining,
      resetAt: new Date(parsed.resources.core.reset * GITHUB_EPOCH_SECOND_MS).toISOString(),
    };
  }
}
