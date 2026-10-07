/** Owns GitHub discovery operations and their provider-specific API semantics. */

import { z } from "zod";

import { PROVIDER_PAGE_SIZE } from "../const.js";
import { ProviderTransportError } from "../failures.js";
import { classifyProviderLookupFailure, PROVIDER_ISSUE_LOOKUP_ERROR, ProviderIssueLookupError } from "../lookup-errors.js";
import { PROVIDER_OPERATION_ERROR } from "../operation-errors.js";
import type {
  ProviderTransport,
} from "../types.js";
import { GITHUB_PR_FIELDS } from "./const.js";
import { GitHubRepository } from "./repository.js";
import { GhPullRequestSchema, GhRestPullSchema,GhTimelineSchema } from "./schema.js";
import type {
  GhPullRequest,
} from "./types.js";

/** Implements the discovery capability using dependencies shared by one adapter instance. */
export class GitHubDiscovery {
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   * @param repository - Shared repository capability for this adapter.
   */
  constructor(private readonly transport: ProviderTransport, private readonly repository: GitHubRepository) {}

  /**
   * Find PRs linked to an issue via GitHub's timeline API (GraphQL).
   * This catches PRs regardless of branch naming convention.
   * Returns null only for a known rejected unsupported query; operational and malformed-response failures propagate.
   * @param issueId - Managed issue whose linked PR observations are requested.
   */
  async findPrsViaTimeline(issueId: number): Promise<GhPullRequest[] | null> {
    const repo = await this.repository.getRepoInfo();
    const query = `query($endCursor: String) {
      repository(owner: ${JSON.stringify(repo.owner)}, name: ${JSON.stringify(repo.name)}) {
        issue(number: ${issueId}) {
          timelineItems(itemTypes: [CONNECTED_EVENT, CROSS_REFERENCED_EVENT], first: ${PROVIDER_PAGE_SIZE}, after: $endCursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              ... on ConnectedEvent { subject { ... on PullRequest { number title body headRefName state url mergedAt reviewDecision mergeable } } }
              ... on CrossReferencedEvent { source { ... on PullRequest { number title body headRefName state url mergedAt reviewDecision mergeable } } }
            }
          }
        }
      }
    }`;

    try {
      const raw: unknown = JSON.parse(await this.transport.read(["api", "graphql", "--paginate", "--slurp", "-f", `query=${query}`]));
      const pages = z.array(GhTimelineSchema).min(1).parse(raw);
      const last = pages[pages.length - 1].data.repository.issue.timelineItems;

      if (last.pageInfo.hasNextPage) throw new Error("Incomplete GitHub timeline pagination.");
      const prs = new Map<number, GhPullRequest>();

      for (const page of pages) {
        for (const node of page.data.repository.issue.timelineItems.nodes) {
          const reference = node.subject ?? node.source;

          if (!reference?.number || !reference.url) continue;
          const expectedPath = `/${repo.owner}/${repo.name}/pull/${reference.number}`;

          if (new URL(reference.url).pathname.toLowerCase() !== expectedPath.toLowerCase()) continue;
          const pr = GhPullRequestSchema.parse(reference);

          prs.set(pr.number, pr);
        }
      }

      return [...prs.values()];
    } catch (error) {
      if (error instanceof ProviderTransportError && !error.failure.outcomeUnknown
        && error.failure.code === PROVIDER_OPERATION_ERROR.VALIDATION_FAILED) return null;
      throw classifyProviderLookupFailure("github", error);
    }
  }

  /** Discover all candidates with a concrete DTO, selecting newer PR IDs consistently across capabilities.
   * @param issueId - Managed issue whose PR candidates are requested.
   * @param state - Lifecycle state to retain after complete discovery.
   */
  async findPrsForIssue(issueId: number, state: "open" | "merged" | "all"): Promise<GhPullRequest[]> {
    const linked = await this.findPrsViaTimeline(issueId);
    let candidates = linked ?? [];

    if (!linked?.some(pr => pr.state === "OPEN")) {
      const all = await this.transport.collection("repos/:owner/:repo/pulls?state=all", GhRestPullSchema);
      const branchPattern = new RegExp(`^(?:fix|feat|feature|chore|bugfix|hotfix|refactor|docs|test)/${issueId}-`);
      const mention = new RegExp(`(^|[^A-Za-z0-9_#])#${issueId}(?![A-Za-z0-9_])`);
      const byBranch = all.filter(pr => branchPattern.test(pr.head.ref));
      const matching = byBranch.length ? byBranch : all.filter(pr => mention.test(pr.title) || mention.test(pr.body ?? ""));

      candidates = [...(linked ?? [])];
      for (const pr of matching) {
        const raw: unknown = JSON.parse(await this.transport.read(["pr", "view", String(pr.number), "--json", GITHUB_PR_FIELDS]));

        candidates.push(GhPullRequestSchema.parse(raw));
      }
    }

    const unique = new Map(candidates.map(pr => [pr.number, pr]));

    return [...unique.values()].filter(pr => state === "all" || (state === "open" ? pr.state === "OPEN" : pr.state === "MERGED"))
      .sort((a, b) => b.number - a.number);
  }

  /** Resolve the observed request explicitly, preventing a newer candidate from silently replacing it.
   * @param issueId - Managed issue whose open PRs are searched.
   * @param prUrl - Optional exact URL previously observed by the application.
   */
  async selectOpenPr(issueId: number, prUrl?: string): Promise<GhPullRequest | undefined> {
    const candidates = await this.findPrsForIssue(issueId, "open");
    const selected = prUrl ? candidates.find(pr => pr.url === prUrl) : candidates[0];

    if (prUrl && !selected) throw new ProviderIssueLookupError({ code: PROVIDER_ISSUE_LOOKUP_ERROR.UNKNOWN, provider: "github",
      retryable: false, message: `Previously selected PR is no longer available as an open request: ${prUrl}` });

    return selected;
  }
}
