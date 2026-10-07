/**
 * GitHubProvider — IssueProvider implementation using gh CLI.
 */

import { z } from "zod";

import type { RunCommand } from "../../context.js";
import { DEFAULT_WORKFLOW, getLabelColors, getStateLabels, type WorkflowConfig } from "../../domain/index.js";
import type { CreateIssueInput } from "./capabilities.js";
import { runProviderCommand } from "./command.js";
import { hasIssueCommitOnBaseBranch } from "./commit-references.js";
import { GITHUB_PR_FIELDS, GITHUB_REVIEW_BOT_SUFFIX, PR_COMMENT_KIND, PROVIDER_COMMAND_MODE, PROVIDER_PAGE_SIZE, PROVIDER_REVIEW_STATE } from "./const.js";
import { normalizeProviderFailure, ProviderTransportError } from "./failures.js";
import {
  classifyProviderLookupFailure,
  classifyProviderProjectAccessFailure,
  mayBeMissingProviderIssue,
  PROVIDER_ISSUE_LOOKUP_ERROR,
  ProviderIssueLookupError,
} from "./lookup-errors.js";
import { classifyProviderOperationError, PROVIDER_OPERATION_ERROR, ProviderOperationError } from "./operation-errors.js";
import { parseProviderPages } from "./pagination.js";
import type { IssueProvider } from "./provider.js";
import { createProviderPolicy, withResilience } from "./resilience.js";
import { latestFormalReviews } from "./review-observations.js";
import { type Issue, type IssueComment, type PrReviewComment, PrState, type PrStatus, type StateLabel } from "./types.js";

type GhIssue = {
  number: number;
  title: string;
  body?: string | null;
  labels: Array<{ name: string }>;
  state: string;
  url: string;
};

const GhIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable().optional(),
  labels: z.array(z.object({ name: z.string() })),
  state: z.string(),
  url: z.string(),
});
const GhRateLimitSchema = z.object({
  resources: z.object({ core: z.object({ remaining: z.number().int().nonnegative(), reset: z.number() }) }),
});

/** Validates repository identity before a successful observation enters the instance cache. */
const GhRepositorySchema = z.object({ owner: z.object({ login: z.string().min(1) }), name: z.string().min(1) });

/** Timeline references may point at other entities; only confirmed PR fields are consumed. */
const GhTimelineReferenceSchema = z.object({
  number: z.number().int().positive().safe().optional(),
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
  url: z.string().optional(),
  mergedAt: z.string().nullable().optional(),
  reviewDecision: z.string().nullable().optional(),
  state: z.string().optional(),
  mergeable: z.string().nullable().optional(),
});

/** A malformed or partial GraphQL response cannot establish that no linked PR exists. */
const GhTimelineSchema = z.object({
  errors: z.array(z.unknown()).optional(),
  data: z.object({ repository: z.object({ issue: z.object({ timelineItems: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    nodes: z.array(z.object({ subject: GhTimelineReferenceSchema.nullable().optional(), source: GhTimelineReferenceSchema.nullable().optional() })),
  }) }) }) }),
}).refine(response => !response.errors?.length, "Partial GraphQL response cannot establish PR absence.");

/** Concrete PR observation used consistently by every GitHub operation. */
const GhPullRequestSchema = z.object({
  number: z.number().int().positive().safe(), title: z.string(), body: z.string().nullable().optional().transform(value => value ?? ""),
  headRefName: z.string().nullable().optional().transform(value => value ?? ""), url: z.string().min(1),
  state: z.enum(["OPEN", "MERGED", "CLOSED"]), mergedAt: z.string().nullable().optional().transform(value => value ?? null),
  reviewDecision: z.string().nullable().optional().transform(value => value ?? null),
  mergeable: z.string().nullable().optional().transform(value => value ?? null),
});

/** Internal confirmed PR DTO inferred from the owning boundary schema. */
type GhPullRequest = z.infer<typeof GhPullRequestSchema>;

/** REST pull-request listing fields used for complete fallback discovery. */
const GhRestPullSchema = z.object({ number: z.number().int().positive().safe(), title: z.string(), body: z.string().nullable(),
  head: z.object({ ref: z.string() }), html_url: z.string().min(1) });

/** Review summaries carry timestamps for selecting the latest formal decision per reviewer. */
const GhReviewSchema = z.object({ id: z.number().int().positive().safe(), user: z.object({ login: z.string() }),
  body: z.string().nullable().optional().transform(value => value ?? ""), state: z.string(),
  submitted_at: z.string().refine(value => Number.isFinite(Date.parse(value)), "Invalid review timestamp.").nullable() });

/** Complete cosmetic reaction payload used only as an indicator, never a durable receipt. */
const GhReactionSchema = z.object({ content: z.string() });

/** Conversation comments retain cosmetic reaction counts independently of summary receipts. */
const GhCommentSchema = z.object({ id: z.number().int().positive().safe(), user: z.object({ login: z.string() }), body: z.string(), created_at: z.string(),
  reactions: z.object({ eyes: z.number().nonnegative().optional() }).optional() });

/** Inline review comments have a namespace distinct from summaries and conversations. */
const GhInlineSchema = GhCommentSchema.extend({ path: z.string().optional(), line: z.number().nullable().optional() });

/** REST issue collection DTO includes pull-request markers so they are not reported as issues. */
const GhRestIssueSchema = z.object({ number: z.number().int().positive().safe(), title: z.string(), body: z.string().nullable(),
  labels: z.array(z.object({ name: z.string() })), state: z.string(), html_url: z.string(), pull_request: z.unknown().optional() });

function toIssue(gh: GhIssue): Issue {
  return {
    iid: gh.number, title: gh.title, description: gh.body ?? "",
    labels: gh.labels.map((l) => l.name), state: gh.state, web_url: gh.url,
  };
}

export class GitHubProvider implements IssueProvider {
  private repoPath: string;
  private workflow: WorkflowConfig;
  private runCommand: RunCommand;

  constructor(opts: { repoPath: string; runCommand: RunCommand; workflow?: WorkflowConfig }) {
    this.repoPath = opts.repoPath;
    this.runCommand = opts.runCommand;
    this.workflow = opts.workflow ?? DEFAULT_WORKFLOW;
  }

  /** Resilience state belongs to this concrete adapter, not other projects or providers. */
  private readonly policy = createProviderPolicy();

  /** Read provider data with retries limited to classified temporary failures.
   * @param args - Read-only CLI arguments.
   */
  private async gh(args: string[]): Promise<string> {
    return withResilience(PROVIDER_COMMAND_MODE.READ, this.policy, () =>
      runProviderCommand(this.runCommand, ["gh", ...args], this.repoPath));
  }

  /** Read complete REST pages, rejecting incomplete process output and malformed provider records.
   * @param endpoint - Project-scoped REST collection including optional filters.
   * @param schema - Provider-owned element validation contract.
   */
  private async ghCollection<T>(endpoint: string, schema: z.ZodType<T>): Promise<T[]> {
    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const raw = await this.gh(["api", `${endpoint}${separator}per_page=${PROVIDER_PAGE_SIZE}`, "--paginate", "--slurp"]);

      return parseProviderPages(raw, schema, true);
    } catch (error) { throw classifyProviderLookupFailure("github", error); }
  }

  /** Repeat only a mutation whose desired final state is explicitly idempotent.
   * @param args - CLI arguments setting an idempotent provider state.
   */
  private async ghWrite(args: string[]): Promise<string> {
    return withResilience(PROVIDER_COMMAND_MODE.IDEMPOTENT, this.policy, () => this.ghOnce(args));
  }

  /** Submit a mutation once, retaining its typed failure and request-outcome evidence.
   * @param args - CLI arguments for one mutation attempt.
   */
  private async ghOnce(args: string[]): Promise<string> {
    try {
      return await withResilience(PROVIDER_COMMAND_MODE.ONCE, this.policy, () =>
        runProviderCommand(this.runCommand, ["gh", ...args], this.repoPath));
    } catch (error) {
      throw classifyProviderOperationError(error);
    }
  }

  /** Cached repo owner/name for GraphQL queries. */
  private repoInfo: { owner: string; name: string } | undefined = undefined;

  /** Cache only confirmed repository identity; failures leave future observations recoverable. */
  private async getRepoInfo(): Promise<{ owner: string; name: string }> {
    if (this.repoInfo !== undefined) return this.repoInfo;
    try {
      const raw: unknown = JSON.parse(await this.gh(["repo", "view", "--json", "owner,name"]));
      const data = GhRepositorySchema.parse(raw);

      this.repoInfo = { owner: data.owner.login, name: data.name };

      return this.repoInfo;
    } catch (error) {
      throw classifyProviderLookupFailure("github", error);
    }
  }

  /**
   * Find PRs linked to an issue via GitHub's timeline API (GraphQL).
   * This catches PRs regardless of branch naming convention.
   * Returns null only for a known rejected unsupported query; operational and malformed-response failures propagate.
   * @param issueId - Managed issue whose linked PR observations are requested.
   * @param state - Provider lifecycle states to retain in the result.
   */
  private async findPrsViaTimeline(issueId: number): Promise<GhPullRequest[] | null> {
    const repo = await this.getRepoInfo();
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
      const raw: unknown = JSON.parse(await this.gh(["api", "graphql", "--paginate", "--slurp", "-f", `query=${query}`]));
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
  private async findPrsForIssue(issueId: number, state: "open" | "merged" | "all"): Promise<GhPullRequest[]> {
    const linked = await this.findPrsViaTimeline(issueId);
    let candidates = linked ?? [];

    if (!linked?.some(pr => pr.state === "OPEN")) {
      const all = await this.ghCollection("repos/:owner/:repo/pulls?state=all", GhRestPullSchema);
      const branchPattern = new RegExp(`^(?:fix|feat|feature|chore|bugfix|hotfix|refactor|docs|test)/${issueId}-`);
      const mention = new RegExp(`(^|[^A-Za-z0-9_#])#${issueId}(?![A-Za-z0-9_])`);
      const byBranch = all.filter(pr => branchPattern.test(pr.head.ref));
      const matching = byBranch.length ? byBranch : all.filter(pr => mention.test(pr.title) || mention.test(pr.body ?? ""));

      candidates = [...(linked ?? [])];
      for (const pr of matching) {
        const raw: unknown = JSON.parse(await this.gh(["pr", "view", String(pr.number), "--json", GITHUB_PR_FIELDS]));

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
  private async selectOpenPr(issueId: number, prUrl?: string): Promise<GhPullRequest | undefined> {
    const candidates = await this.findPrsForIssue(issueId, "open");
    const selected = prUrl ? candidates.find(pr => pr.url === prUrl) : candidates[0];

    if (prUrl && !selected) throw new ProviderIssueLookupError({ code: PROVIDER_ISSUE_LOOKUP_ERROR.UNKNOWN, provider: "github",
      retryable: false, message: `Previously selected PR is no longer available as an open request: ${prUrl}` });

    return selected;
  }

  async ensureLabel(name: string, color: string): Promise<void> {
    await this.ghWrite(["label", "create", name, "--color", color.replace(/^#/, ""), "--force"]);
  }

  async ensureAllStateLabels(): Promise<void> {
    const labels = getStateLabels(this.workflow);
    const colors = getLabelColors(this.workflow);

    for (const label of labels) {
      const color = colors.get(label);

      if (!color) throw new Error(`No color configured for workflow label "${label}".`);
      await this.ensureLabel(label, color);
    }
  }

  async createIssue(input: CreateIssueInput): Promise<Issue> {
    try {
      const args = ["issue", "create", "--title", input.title, "--body", input.body];

      if (input.labels.length) args.push("--label", input.labels.join(","));
      if (input.assignees.length) args.push("--assignee", input.assignees.join(","));
      const url = await this.ghOnce(args);
      const match = url.match(/\/issues\/(\d+)$/);

      if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) <= 0) {
        throw new ProviderOperationError({ code: PROVIDER_OPERATION_ERROR.UNKNOWN, message: "Issue creation returned no confirmed identity.",
          retryable: false, outcomeUnknown: true });
      }

      return {
        iid: parseInt(match[1], 10),
        title: input.title,
        description: input.body,
        labels: [...input.labels],
        state: "OPEN",
        web_url: url,
      };
    } catch (error) {
      throw classifyProviderOperationError(error);
    }
  }

  /** List all open issues carrying the requested provider-visible label.
   * @param label - Provider label used as a read-only filter.
   */
  async listIssuesByLabel(label: StateLabel): Promise<Issue[]> {
    return this.listIssues({ label, state: "open" });
  }

  /** Read every matching issue page; pull requests returned by the REST issues endpoint are excluded.
   * @param opts - Provider-side issue state and label filters.
   */
  async listIssues(opts?: { label?: string; state?: "open" | "closed" | "all" }): Promise<Issue[]> {
    const label = opts?.label ? `&labels=${encodeURIComponent(opts.label)}` : "";
    const issues = await this.ghCollection(`repos/:owner/:repo/issues?state=${opts?.state ?? "open"}${label}`, GhRestIssueSchema);

    return issues.filter(issue => issue.pull_request === undefined).map(issue => toIssue({ ...issue, url: issue.html_url }));
  }

  async getIssue(issueId: number): Promise<Issue> {
    try {
      const raw = await this.gh(["issue", "view", String(issueId), "--json", "number,title,body,labels,state,url"]);
      const parsed: unknown = JSON.parse(raw);

      return toIssue(GhIssueSchema.parse(parsed));
    } catch (error) {
      if (mayBeMissingProviderIssue(error)) {
        try {
          await this.gh(["repo", "view", "--json", "name"]);
          throw new ProviderIssueLookupError({
            code: PROVIDER_ISSUE_LOOKUP_ERROR.ISSUE_NOT_FOUND,
            provider: "github",
            retryable: false,
            status: 404,
            message: `GitHub issue #${issueId} does not exist while repository access remains valid.`,
            cause: error,
          });
        } catch (accessError) {
          if (accessError instanceof ProviderIssueLookupError) throw accessError;
          throw classifyProviderProjectAccessFailure("github", accessError);
        }
      }

      throw classifyProviderLookupFailure("github", error);
    }
  }

  /** Read GitHub's current core API quota for repair mutation preflight. */
  async getRateLimitStatus(): Promise<{ remaining: number; resetAt: string }> {
    const parsed = GhRateLimitSchema.parse(JSON.parse(await this.gh(["api", "rate_limit"])));

    return {
      remaining: parsed.resources.core.remaining,
      resetAt: new Date(parsed.resources.core.reset * 1_000).toISOString(),
    };
  }

  /** Read all issue conversation pages before building worker context.
   * @param issueId - Provider issue whose complete discussion is requested.
   */
  async listComments(issueId: number): Promise<IssueComment[]> {
    const comments = await this.ghCollection(`repos/:owner/:repo/issues/${issueId}/comments`, GhCommentSchema);

    return comments.map(comment => ({ id: comment.id, author: comment.user.login, body: comment.body, created_at: comment.created_at }));
  }

  async transitionLabel(issueId: number, from: StateLabel, to: StateLabel): Promise<void> {
    // Two-phase transition to ensure atomicity and recoverability:
    // Phase 1: Add new label first (safer than removing first)
    // Phase 2: Remove old state labels
    // This way, if phase 2 fails, the issue still has the new label (issue is correctly transitioned)
    // instead of having no state label at all.

    await this.ghWrite(["issue", "edit", String(issueId), "--add-label", to]);

    // Remove old state labels (best-effort if there are multiple old labels)
    const issue = await this.getIssue(issueId);
    const stateLabels = new Set<string>(getStateLabels(this.workflow));
    const currentStateLabels = issue.labels.filter((label) => stateLabels.has(label) && label !== to);

    if (currentStateLabels.length > 0) {
      const args = ["issue", "edit", String(issueId)];

      for (const l of currentStateLabels) args.push("--remove-label", l);
      await this.ghWrite(args);
    }

    // Post-transition validation: verify exactly one state label remains (#473)
    try {
      const postIssue = await this.getIssue(issueId);
      const postStateLabels = postIssue.labels.filter((label) => stateLabels.has(label));

      if (postStateLabels.length !== 1 || !postStateLabels.includes(to)) {
        // Log anomaly but don't throw — transition is already committed
        console.error(
          `[state_transition_anomaly] Issue #${issueId}: expected state "${to}", ` +
          `found ${postStateLabels.length} state label(s): [${postStateLabels.join(", ")}]. ` +
          `Transition: "${from}" → "${to}". See #473.`,
        );
      }
    } catch {
      // Validation is best-effort — don't break the transition
    }
  }

  async addLabel(issueId: number, label: string): Promise<void> {
    await this.ghWrite(["issue", "edit", String(issueId), "--add-label", label]);
  }

  async removeLabels(issueId: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const args = ["issue", "edit", String(issueId)];

    for (const l of labels) args.push("--remove-label", l);
    await this.ghWrite(args);
  }

  async closeIssue(issueId: number): Promise<void> { await this.ghWrite(["issue", "close", String(issueId)]); }
  async reopenIssue(issueId: number): Promise<void> { await this.ghWrite(["issue", "reopen", String(issueId)]); }
  supportsIssueDeletion(): boolean { return true; }
  /** Delete once; abnormal completion never proves successful deletion.
   * @param issueId - Provider identity explicitly selected for deletion.
   */
  async deleteIssue(issueId: number): Promise<void> {
    await this.ghOnce(["issue", "delete", String(issueId), "--confirm"]);
  }

  async getMergedMRUrl(issueId: number): Promise<string | null> {
    const prs = await this.findPrsForIssue(issueId, "merged");

    if (prs.length === 0) return null;

    return prs[0].url;
  }

  /** Observe PR state; missing PRs require successful lookup and failed reads remain typed errors.
   * @param issueId - Managed issue whose associated PR state is observed.
   * @param prUrl - Optional exact request URL supplied by prior application evidence.
   */
  async getPrStatus(issueId: number, prUrl?: string): Promise<PrStatus> {
    const found = await this.findPrsForIssue(issueId, "all");
    const candidates = prUrl ? found.filter(pr => pr.url === prUrl) : found;

    if (prUrl && !candidates.length) throw new ProviderIssueLookupError({ code: PROVIDER_ISSUE_LOOKUP_ERROR.UNKNOWN, provider: "github",
      retryable: false, message: `Previously selected PR is no longer associated with this issue: ${prUrl}` });
    const open = candidates.find(pr => pr.state === "OPEN");

    if (open) {
      const reviews = await this.readReviews(open.number);
      const summaries = reviews.filter(review => review.state === PROVIDER_REVIEW_STATE.COMMENTED && review.body.trim().length > 0);
      const conversations = await this.fetchConversationComments(open.number);
      const inlines = await this.ghCollection(`repos/:owner/:repo/pulls/${open.number}/comments`, GhInlineSchema);
      const hasCommentFeedback = conversations.some(comment => (comment.reactions?.eyes ?? 0) === 0)
        || inlines.some(comment => !comment.user.login.endsWith(GITHUB_REVIEW_BOT_SUFFIX) && comment.body.trim().length > 0 && (comment.reactions?.eyes ?? 0) === 0);
      const decisions = latestFormalReviews(reviews);
      let state: PrState;

      if (open.reviewDecision === PROVIDER_REVIEW_STATE.CHANGES_REQUESTED
        || decisions.some(review => review.state === PROVIDER_REVIEW_STATE.CHANGES_REQUESTED)) state = PrState.CHANGES_REQUESTED;
      else if (open.reviewDecision === PROVIDER_REVIEW_STATE.APPROVED
        || decisions.some(review => review.state === PROVIDER_REVIEW_STATE.APPROVED)) state = PrState.APPROVED;
      else state = hasCommentFeedback || summaries.length ? PrState.HAS_COMMENTS : PrState.OPEN;
      const mergeable = open.mergeable === "CONFLICTING" ? false : open.mergeable === "MERGEABLE" ? true : undefined;

      return { state, url: open.url, title: open.title, sourceBranch: open.headRefName, mergeable,
        reviewSummaries: summaries, hasCommentFeedback };
    }

    const merged = candidates.find(pr => pr.state === "MERGED");

    if (merged) return { state: PrState.MERGED, url: merged.url, title: merged.title, sourceBranch: merged.headRefName };
    const closed = candidates.find(pr => pr.state === "CLOSED");

    return closed ? { state: PrState.CLOSED, url: closed.url, title: closed.title, sourceBranch: closed.headRefName } : { state: PrState.CLOSED, url: null };
  }

  /** Read complete review summaries while keeping their reaction-free source identity.
   * @param prNumber - Exact selected pull request.
   */
  private async readReviews(prNumber: number): Promise<PrReviewComment[]> {
    const reviews = await this.ghCollection(`repos/:owner/:repo/pulls/${prNumber}/reviews`, GhReviewSchema);

    return reviews.filter(review => review.submitted_at !== null && !review.user.login.endsWith(GITHUB_REVIEW_BOT_SUFFIX)).map(review => ({ kind: PR_COMMENT_KIND.REVIEW,
      id: review.id, author: review.user.login, body: review.body, state: review.state, created_at: review.submitted_at ?? "" }));
  }

  /** Read complete human PR conversations; author comments remain eligible.
   * @param prNumber - Exact selected pull request.
   */
  private async fetchConversationComments(prNumber: number) {
    const comments = await this.ghCollection(`repos/:owner/:repo/issues/${prNumber}/comments`, GhCommentSchema);

    return comments.filter(comment => !comment.user.login.endsWith(GITHUB_REVIEW_BOT_SUFFIX) && comment.body.trim().length > 0);
  }

  /** Merge one exact observed PR, never redirecting to another open candidate.
   * @param issueId - Managed issue whose request is selected.
   * @param prUrl - Optional exact URL supplied by prior application evidence.
   */
  async mergePr(issueId: number, prUrl?: string): Promise<void> {
    const pr = await this.selectOpenPr(issueId, prUrl);

    if (!pr) throw new Error(`No open PR found for issue #${issueId}`);
    await this.ghOnce(["pr", "merge", pr.url, "--merge"]);
  }

  /** Read the same selected PR's diff; failed explicit selection cannot yield another request's content.
   * @param issueId - Managed issue whose request is selected.
   * @param prUrl - Optional exact URL supplied by prior application evidence.
   */
  async getPrDiff(issueId: number, prUrl?: string): Promise<string | null> {
    const pr = await this.selectOpenPr(issueId, prUrl);

    if (!pr) return null;
    try {
      return await this.gh(["pr", "diff", String(pr.number)]);
    } catch (error) { throw classifyProviderLookupFailure("github", error); }
  }

  /** Read every feedback source for the same deterministically selected open PR.
   * @param issueId - Managed issue whose full PR feedback is requested.
   * @param prUrl - Exact observed request to read, when supplied.
   */
  async getPrReviewComments(issueId: number, prUrl?: string): Promise<PrReviewComment[]> {
    const pr = await this.selectOpenPr(issueId, prUrl);

    if (!pr) return [];
    const prNumber = pr.number;
    const reviews = await this.readReviews(prNumber);
    const comments = [
      ...reviews.filter(review => review.state === PROVIDER_REVIEW_STATE.COMMENTED && review.body.trim().length > 0),
      ...latestFormalReviews(reviews).filter(review => review.state !== PROVIDER_REVIEW_STATE.DISMISSED),
    ];
    const inlines = await this.ghCollection(`repos/:owner/:repo/pulls/${prNumber}/comments`, GhInlineSchema);

    for (const comment of inlines.filter(comment => !comment.user.login.endsWith(GITHUB_REVIEW_BOT_SUFFIX))) {
      comments.push({ kind: PR_COMMENT_KIND.INLINE, id: comment.id, author: comment.user.login, body: comment.body,
        state: "INLINE", created_at: comment.created_at, path: comment.path, line: comment.line ?? undefined });
    }

    for (const comment of await this.fetchConversationComments(prNumber)) {
      comments.push({ kind: PR_COMMENT_KIND.CONVERSATION, id: comment.id, author: comment.user.login,
        body: comment.body, state: PROVIDER_REVIEW_STATE.COMMENTED, created_at: comment.created_at });
    }

    return comments.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
  }

  /** Create one comment without replaying a mutation whose response may have been lost.
   * @param issueId - Provider issue receiving the comment.
   * @param body - Complete comment text submitted once.
   */
  async addComment(issueId: number, body: string): Promise<number> {
    let raw: string;

    try {
      raw = await this.ghOnce([
        "api", `repos/:owner/:repo/issues/${issueId}/comments`,
        "--method", "POST", "--field", `body=${body}`,
      ]);
    } catch (error) {
      throw classifyProviderOperationError(error);
    }

    try {
      const response: unknown = JSON.parse(raw);

      return z.object({ id: z.number().int().positive().safe() }).parse(response).id;
    } catch (error) {
      throw new ProviderOperationError({ code: PROVIDER_OPERATION_ERROR.UNKNOWN,
        message: "GitHub comment creation returned no confirmed comment identity.",
        retryable: false, outcomeUnknown: true, cause: error });
    }
  }

  async reactToIssue(issueId: number, emoji: string): Promise<void> {
    try {
      await this.ghOnce([
        "api", `repos/:owner/:repo/issues/${issueId}/reactions`,
        "--method", "POST",
        "--field", `content=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  async issueHasReaction(issueId: number, emoji: string): Promise<boolean> {
    try {
      const reactions = await this.ghCollection(`repos/:owner/:repo/issues/${issueId}/reactions`, GhReactionSchema);

      return reactions.some((r) => r.content === emoji);
    } catch { return false; }
  }

  async reactToPr(issueId: number, emoji: string): Promise<void> {
    try {
      // GitHub PRs are also issues — use the same reactions API with the PR number
        const prs = await this.findPrsForIssue(issueId, "open");

      if (prs.length === 0) return;
      await this.ghOnce([
        "api", `repos/:owner/:repo/issues/${prs[0].number}/reactions`,
        "--method", "POST",
        "--field", `content=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  async prHasReaction(issueId: number, emoji: string): Promise<boolean> {
    try {
        const prs = await this.findPrsForIssue(issueId, "open");

      if (prs.length === 0) return false;
      const reactions = await this.ghCollection(`repos/:owner/:repo/issues/${prs[0].number}/reactions`, GhReactionSchema);

      return reactions.some((r) => r.content === emoji);
    } catch { return false; }
  }

  async reactToIssueComment(_issueId: number, commentId: number, emoji: string): Promise<void> {
    try {
      await this.ghOnce([
        "api", `repos/:owner/:repo/issues/comments/${commentId}/reactions`,
        "--method", "POST",
        "--field", `content=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  /**
   * Add an emoji reaction to a PR/MR issue comment.
   * Uses the GitHub Issues Comments Reactions API (PRs share the issue comment namespace).
   * Best-effort — swallows all errors.
   */
  async reactToPrComment(_issueId: number, commentId: number, emoji: string): Promise<void> {
    try {
      await this.ghOnce([
        "api", `repos/:owner/:repo/issues/comments/${commentId}/reactions`,
        "--method", "POST",
        "--field", `content=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  /** React to an inline review comment using its distinct pull-request comment namespace.
   * @param _issueId - Owning issue; comment IDs already identify the repository resource.
   * @param commentId - Inline review comment identifier, never a review summary ID.
   * @param emoji - GitHub reaction content.
   */
  async reactToPrReviewComment(_issueId: number, commentId: number, emoji: string): Promise<void> {
    await this.ghOnce(["api", `repos/:owner/:repo/pulls/comments/${commentId}/reactions`,
      "--method", "POST", "--field", `content=${emoji}`]);
  }

  async issueCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    try {
      const reactions = await this.ghCollection(`repos/:owner/:repo/issues/comments/${commentId}/reactions`, GhReactionSchema);

      return reactions.some((r) => r.content === emoji);
    } catch { return false; }
  }

  async prCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    try {
      const reactions = await this.ghCollection(`repos/:owner/:repo/issues/comments/${commentId}/reactions`, GhReactionSchema);

      return reactions.some((r) => r.content === emoji);
    } catch { return false; }
  }

  /** Check existing reactions in the inline review-comment namespace.
   * @param _issueId - Owning issue; the comment ID identifies the resource.
   * @param commentId - Inline review comment identifier.
   * @param emoji - Reaction content to find.
   */
  async prReviewCommentHasReaction(_issueId: number, commentId: number, emoji: string): Promise<boolean> {
    const reactions = await this.ghCollection(`repos/:owner/:repo/pulls/comments/${commentId}/reactions`, GhReactionSchema);

    return reactions.some(reaction => reaction.content === emoji);
  }

  async editIssue(issueId: number, updates: { title?: string; body?: string }): Promise<Issue> {
    const args = ["issue", "edit", String(issueId)];

    if (updates.title !== undefined) args.push("--title", updates.title);
    if (updates.body !== undefined) args.push("--body", updates.body);
    await this.ghWrite(args);

    return this.getIssue(issueId);
  }

  /**
   * Check if work for an issue is already present on the base branch via git log.
   * Searches complete reachable history for an exact issue reference without a numeric-prefix match.
   * Used as a fallback when no PR exists (e.g., direct commit to main).
   * @param issueId - Positive issue identifier to match exactly.
   * @param baseBranch - Configured base branch whose history is inspected.
   */
  async isCommitOnBaseBranch(issueId: number, baseBranch: string): Promise<boolean> {
    try {
      return await hasIssueCommitOnBaseBranch(this.runCommand, this.repoPath, issueId, baseBranch);
    } catch (error) { throw classifyProviderLookupFailure("github", error); }
  }

  async uploadAttachment(
    issueId: number,
    file: { filename: string; buffer: Buffer; mimeType: string },
  ): Promise<string | null> {
    try {
      const branch = "devclaw-attachments";
      const safeFilename = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `attachments/${issueId}/${Date.now()}-${safeFilename}`;
      const base64Content = file.buffer.toString("base64");

      // Get repo owner/name
      const repo = await this.getRepoInfo();


      // Ensure branch exists
      let branchExists = false;

      try {
        await this.gh(["api", `repos/${repo.owner}/${repo.name}/git/ref/heads/${branch}`]);
        branchExists = true;
      } catch (error) {
        const failure = normalizeProviderFailure(error);

        if (failure.code !== PROVIDER_OPERATION_ERROR.NOT_FOUND || failure.outcomeUnknown) throw error;
      }

      if (!branchExists) {
        const raw = await this.gh([
          "repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name",
        ]);
        const defaultBranch = raw.trim();
        const shaRaw = await this.gh([
          "api", `repos/${repo.owner}/${repo.name}/git/ref/heads/${defaultBranch}`,
          "--jq", ".object.sha",
        ]);

        await this.ghOnce([
          "api", `repos/${repo.owner}/${repo.name}/git/refs`,
          "--method", "POST",
          "--field", `ref=refs/heads/${branch}`,
          "--field", `sha=${shaRaw.trim()}`,
        ]);
      }

      // Upload via Contents API
      await this.ghOnce([
        "api", `repos/${repo.owner}/${repo.name}/contents/${filePath}`,
        "--method", "PUT",
        "--field", `message=attachment: ${file.filename} for issue #${issueId}`,
        "--field", `content=${base64Content}`,
        "--field", `branch=${branch}`,
      ]);

      return `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/${filePath}`;
    } catch {
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.gh(["auth", "status"]);

      return true;
    } catch { return false; }
  }
}
