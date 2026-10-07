/**
 * GitLabProvider — IssueProvider implementation using glab CLI.
 */

import { z } from "zod";

import type { RunCommand } from "../../context.js";
import { DEFAULT_WORKFLOW, getLabelColors, getStateLabels, type WorkflowConfig } from "../../domain/index.js";
import type { CreateIssueInput } from "./capabilities.js";
import { runProviderCommand } from "./command.js";
import { hasIssueCommitOnBaseBranch } from "./commit-references.js";
import { GITLAB_INLINE_NOTE_TYPE, PR_COMMENT_KIND, PROVIDER_COMMAND_MODE, PROVIDER_PAGE_SIZE } from "./const.js";
import { uploadGitLabAttachment } from "./gitlab-attachments.js";
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
import { type Issue, type IssueComment, type PrReviewComment, PrState, type PrStatus, type StateLabel } from "./types.js";

const GitLabIssueSchema = z.object({
  iid: z.number(), title: z.string(), description: z.string().nullable().transform(value => value ?? ""), labels: z.array(z.string()),
  state: z.string(), web_url: z.string(),
});

/** Related merge-request responses must confirm identity before they can drive observations. */
const GitLabMRSchema = z.object({
  iid: z.number().int().positive().safe(),
  project_id: z.number().int().positive().safe(),
  title: z.string(),
  description: z.string().nullable().optional().transform(value => value ?? ""),
  web_url: z.string().min(1),
  state: z.enum(["opened", "merged", "closed"]),
  source_branch: z.string().optional(),
  merged_at: z.string().nullable().optional().transform(value => value ?? null),
});

/** Validated related-request DTO used by every GitLab capability. */
type GitLabMR = z.infer<typeof GitLabMRSchema>;

/** Approval evidence must include the explicit reviewers and remaining required approvals. */
const GitLabApprovalSchema = z.object({ approved_by: z.array(z.unknown()), approvals_left: z.number().int().nonnegative() });

/** GitLab notes keep one shared identity across discussion and conversation endpoints. */
const GitLabNoteSchema = z.object({ id: z.number().int().positive().safe(), author: z.object({ username: z.string() }), body: z.string(),
  created_at: z.string(), system: z.boolean(), resolvable: z.boolean().optional(), resolved: z.boolean().optional(),
  type: z.string().nullable().optional(),
  position: z.object({ new_path: z.string().optional(), new_line: z.number().nullable().optional() }).nullable().optional() });

/** Discussion pages contain notes whose provider identity must be retained. */
const GitLabDiscussionSchema = z.object({ notes: z.array(GitLabNoteSchema) });

/** Cosmetic emoji metadata returned in complete reaction collections. */
const GitLabEmojiSchema = z.object({ name: z.string() });

export class GitLabProvider implements IssueProvider {
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
  private async glab(args: string[]): Promise<string> {
    return withResilience(PROVIDER_COMMAND_MODE.READ, this.policy, () =>
      runProviderCommand(this.runCommand, ["glab", ...args], this.repoPath));
  }

  /** Read every REST page and validate each returned item before reporting a complete collection.
   * @param endpoint - Project-scoped collection endpoint and optional filters.
   * @param schema - Owning provider element schema.
   */
  private async glabCollection<T>(endpoint: string, schema: z.ZodType<T>): Promise<T[]> {
    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const output = await this.glab(["api", `${endpoint}${separator}per_page=${PROVIDER_PAGE_SIZE}`, "--paginate"]);

      return parseProviderPages(output, schema, false);
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /** Repeat only a mutation whose desired final state is explicitly idempotent.
   * @param args - CLI arguments setting an idempotent provider state.
   */
  private async glabWrite(args: string[]): Promise<string> {
    return withResilience(PROVIDER_COMMAND_MODE.IDEMPOTENT, this.policy, () => this.glabOnce(args));
  }

  /** Submit a mutation once, retaining its typed failure and request-outcome evidence.
   * @param args - CLI arguments for one mutation attempt.
   */
  private async glabOnce(args: string[]): Promise<string> {
    try {
      return await withResilience(PROVIDER_COMMAND_MODE.ONCE, this.policy, () =>
        runProviderCommand(this.runCommand, ["glab", ...args], this.repoPath));
    } catch (error) {
      throw classifyProviderOperationError(error);
    }
  }

  /** Read and validate related MRs; transport and malformed-response failures never imply absence.
   * @param issueId - Managed issue whose related merge requests are requested.
   */
  private async getRelatedMRs(issueId: number): Promise<GitLabMR[]> {
    const mrs = await this.glabCollection(`projects/:id/issues/${issueId}/related_merge_requests`, GitLabMRSchema);

    if (!mrs.length) return [];
    const projectId = await this.getProjectId();

    return mrs.filter(mr => mr.project_id === projectId).sort((a, b) => b.iid - a.iid);
  }

  /** Cached confirmed project ID prevents cross-project IID collisions in related MR lists. */
  private projectId: number | undefined;

  /** Resolve the owning project; failures never enter the identity cache. */
  private async getProjectId(): Promise<number> {
    if (this.projectId !== undefined) return this.projectId;
    try {
      const response: unknown = JSON.parse(await this.glab(["api", "projects/:id"]));
      const project = z.object({ id: z.number().int().positive().safe() }).parse(response);

      this.projectId = project.id;

      return project.id;
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /** Resolve the exact observed MR instead of redirecting work to a newer candidate.
   * @param issueId - Managed issue whose related open requests are searched.
   * @param prUrl - Optional exact URL previously observed by the application.
   */
  private async selectOpenMr(issueId: number, prUrl?: string): Promise<GitLabMR | undefined> {
    const candidates = (await this.getRelatedMRs(issueId)).filter(mr => mr.state === "opened");
    const selected = prUrl ? candidates.find(mr => mr.web_url === prUrl) : candidates[0];

    if (prUrl && !selected) throw new ProviderIssueLookupError({ code: PROVIDER_ISSUE_LOOKUP_ERROR.UNKNOWN, provider: "gitlab",
      retryable: false, message: `Previously selected MR is no longer available as an open request: ${prUrl}` });

    return selected;
  }

  async ensureLabel(name: string, color: string): Promise<void> {
    try {
      // Update-first: always set the color on existing labels
      await this.glabWrite([
        "api", `projects/:id/labels/${encodeURIComponent(name)}`,
        "--method", "PUT",
        "--field", `color=${color}`,
      ]);
    } catch (error) {
      const failure = classifyProviderOperationError(error);

      if (failure.code !== PROVIDER_OPERATION_ERROR.NOT_FOUND || failure.outcomeUnknown) throw error;
      // A confirmed missing label permits one create request.
      await this.glabOnce([
        "api", "projects/:id/labels",
        "--method", "POST",
        "--field", `name=${name}`,
        "--field", `color=${color}`,
      ]);
    }
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
      // Pass description directly as argv — runCommand uses spawn (no shell),
      // so no escaping issues with special characters.
      const args = ["issue", "create", "--title", input.title, "--description", input.body];

      if (input.labels.length) args.push("--label", input.labels.join(","));
      if (input.assignees.length) args.push("--assignee", input.assignees.join(","));
      const stdout = await this.glabOnce(args);
      // glab issue create returns the issue URL
      const match = stdout.match(/https?:\/\/\S+\/issues\/(\d+)/);

      if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) <= 0) {
        throw new ProviderOperationError({ code: PROVIDER_OPERATION_ERROR.UNKNOWN, message: "Issue creation returned no confirmed identity.",
          retryable: false, outcomeUnknown: true });
      }

      return {
        iid: parseInt(match[1], 10),
        title: input.title,
        description: input.body,
        labels: [...input.labels],
        state: "opened",
        web_url: match[0],
      };
    } catch (error) {
      throw classifyProviderOperationError(error);
    }
  }

  /** Read all open issue pages carrying the requested label.
   * @param label - Provider-visible issue label.
   */
  async listIssuesByLabel(label: StateLabel): Promise<Issue[]> {
    return this.listIssues({ label, state: "open" });
  }

  /** Read complete issue collections, preserving provider-side filter semantics.
   * @param opts - Optional label and issue lifecycle filters.
   */
  async listIssues(opts?: { label?: string; state?: "open" | "closed" | "all" }): Promise<Issue[]> {
    const state = opts?.state === "open" || opts?.state === undefined ? "opened" : opts.state;
    const label = opts?.label ? `&labels=${encodeURIComponent(opts.label)}` : "";

    return this.glabCollection(`projects/:id/issues?state=${state}${label}`, GitLabIssueSchema);
  }

  async getIssue(issueId: number): Promise<Issue> {
    try {
      const raw = await this.glab(["issue", "view", String(issueId), "--output", "json"]);
      const parsed: unknown = JSON.parse(raw);

      return GitLabIssueSchema.parse(parsed);
    } catch (error) {
      if (mayBeMissingProviderIssue(error)) {
        try {
          await this.glab(["repo", "view", "--output", "json"]);
          throw new ProviderIssueLookupError({
            code: PROVIDER_ISSUE_LOOKUP_ERROR.ISSUE_NOT_FOUND,
            provider: "gitlab",
            retryable: false,
            status: 404,
            message: `GitLab issue #${issueId} does not exist while project access remains valid.`,
            cause: error,
          });
        } catch (accessError) {
          if (accessError instanceof ProviderIssueLookupError) throw accessError;
          throw classifyProviderProjectAccessFailure("gitlab", accessError);
        }
      }

      throw classifyProviderLookupFailure("gitlab", error);
    }
  }

  /** Read all non-system issue notes before constructing worker discussion.
   * @param issueId - Provider issue whose discussion is requested.
   */
  async listComments(issueId: number): Promise<IssueComment[]> {
    const notes = await this.glabCollection(`projects/:id/issues/${issueId}/notes`, GitLabNoteSchema);

    return notes.filter(note => !note.system).map(note => ({ id: note.id, author: note.author.username, body: note.body, created_at: note.created_at }));
  }

  async transitionLabel(issueId: number, from: StateLabel, to: StateLabel): Promise<void> {
    // Two-phase transition to prevent label loss on failure:
    // Phase 1: Add new label first — issue is correctly labelled even if phase 2 fails
    // Phase 2: Remove old state labels (best-effort)
    await this.glabWrite(["issue", "update", String(issueId), "--label", to]);

    const issue = await this.getIssue(issueId);
    const stateLabels = new Set<string>(getStateLabels(this.workflow));
    const currentStateLabels = issue.labels.filter((label) => stateLabels.has(label) && label !== to);

    if (currentStateLabels.length > 0) {
      const args = ["issue", "update", String(issueId)];

      for (const l of currentStateLabels) args.push("--unlabel", l);
      await this.glabWrite(args);
    }

    // Post-transition validation: verify exactly one state label remains (#473)
    try {
      const postIssue = await this.getIssue(issueId);
      const postStateLabels = postIssue.labels.filter((label) => stateLabels.has(label));

      if (postStateLabels.length !== 1 || !postStateLabels.includes(to)) {
        console.error(
          `[state_transition_anomaly] Issue #${issueId}: expected state "${to}", ` +
          `found ${postStateLabels.length} state label(s): [${postStateLabels.join(", ")}]. ` +
          `Transition: "${from}" → "${to}". See #473.`,
        );
      }
    } catch {
      // Validation is best-effort
    }
  }

  async addLabel(issueId: number, label: string): Promise<void> {
    await this.glabWrite(["issue", "update", String(issueId), "--label", label]);
  }

  async removeLabels(issueId: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const args = ["issue", "update", String(issueId)];

    for (const l of labels) args.push("--unlabel", l);
    await this.glabWrite(args);
  }

  async closeIssue(issueId: number): Promise<void> { await this.glabWrite(["issue", "close", String(issueId)]); }
  async reopenIssue(issueId: number): Promise<void> { await this.glabWrite(["issue", "reopen", String(issueId)]); }
  supportsIssueDeletion(): boolean { return true; }
  /** Delete once; abnormal completion never proves successful deletion.
   * @param issueId - Provider identity explicitly selected for deletion.
   */
  async deleteIssue(issueId: number): Promise<void> {
    await this.glabOnce(["api", `projects/:id/issues/${issueId}`, "--method", "DELETE"]);
  }

  async getMergedMRUrl(issueId: number): Promise<string | null> {
    const mrs = await this.getRelatedMRs(issueId);
    const merged = mrs.filter(mr => mr.state === "merged");

    return merged[0]?.web_url ?? null;
  }

  /** Observe MR state; required review read failures propagate rather than reporting no feedback.
   * @param issueId - Managed issue whose associated MR state is observed.
   * @param prUrl - Optional exact request URL supplied by prior application evidence.
   */
  async getPrStatus(issueId: number, prUrl?: string): Promise<PrStatus> {
    const found = await this.getRelatedMRs(issueId);
    const mrs = prUrl ? found.filter(mr => mr.web_url === prUrl) : found;

    if (prUrl && !mrs.length) throw new ProviderIssueLookupError({ code: PROVIDER_ISSUE_LOOKUP_ERROR.UNKNOWN, provider: "gitlab",
      retryable: false, message: `Previously selected MR is no longer associated with this issue: ${prUrl}` });
    // Check open MRs first
    const open = mrs.find((mr) => mr.state === "opened");

    if (open) {
      const approved = await this.isMrApproved(open.iid);

      // Detect changes requested via unresolved discussion threads
      let state: PrState;

      if (approved) {
        state = PrState.APPROVED;
      } else {
        const hasUnresolved = await this.hasUnresolvedDiscussions(open.iid);

        if (hasUnresolved) {
          state = PrState.CHANGES_REQUESTED;
        } else {
          // Check for top-level conversation comments from non-author users
          const hasComments = await this.hasConversationComments(open.iid);

          state = hasComments ? PrState.HAS_COMMENTS : PrState.OPEN;
        }
      }

      // Detect merge conflicts
      const mergeable = await this.isMrMergeable(open.iid);

      return { state, url: open.web_url, title: open.title, sourceBranch: open.source_branch, mergeable };
    }

    // Check merged MRs
    const merged = mrs.find((mr) => mr.state === "merged");

    if (merged) return { state: PrState.MERGED, url: merged.web_url, title: merged.title, sourceBranch: merged.source_branch };
    // Check for closed-without-merge MRs. url: non-null = MR was explicitly closed;
    // url: null = no MR has ever been created for this issue.
    const closed = mrs.find((mr) => mr.state === "closed");

    if (closed) return { state: PrState.CLOSED, url: closed.web_url, title: closed.title, sourceBranch: closed.source_branch };

    return { state: PrState.CLOSED, url: null };
  }

  /** Check if an MR has unresolved discussion threads (proxy for changes requested). */
  private async hasUnresolvedDiscussions(mrIid: number): Promise<boolean> {
    try {
      const discussions = await this.glabCollection(`projects/:id/merge_requests/${mrIid}/discussions`, GitLabDiscussionSchema);

      return discussions.some((d) =>
        d.notes.some((n) => n.resolvable && !n.resolved && !n.system),
      );
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /**
   * Check if an MR has any top-level conversation notes from human users.
   * Excludes only system notes and empty bodies (author comments are included).
   * Uses the MR notes endpoint (regular comments, not threaded discussions).
   */
  private async hasConversationComments(mrIid: number): Promise<boolean> {
    try {
      const notes = await this.glabCollection(`projects/:id/merge_requests/${mrIid}/notes`, GitLabNoteSchema);
      const candidates = notes.filter((n) => !n.system && n.body.trim().length > 0);

      for (const note of candidates) {
        if (!(await this.noteHasEyesEmoji(mrIid, note.id))) return true;
      }

      return false;
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /** Check if a note already has an 👀 award emoji (marks it as processed). */
  private async noteHasEyesEmoji(mrIid: number, noteId: number): Promise<boolean> {
    try {
      const emojis = await this.glabCollection(`projects/:id/merge_requests/${mrIid}/notes/${noteId}/award_emoji`, GitLabEmojiSchema);

      return emojis.some((e) => e.name === "eyes");
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /**
   * Fetch top-level conversation notes on an MR from human users.
   * Excludes only system notes and empty bodies.
   */
  private async fetchConversationComments(
    mrIid: number,
  ): Promise<Array<{ id: number; author: { username: string }; body: string; created_at: string }>> {
    try {
      const all = await this.glabCollection(`projects/:id/merge_requests/${mrIid}/notes`, GitLabNoteSchema);

      return all.filter(
        (n) => !n.system && n.body.trim().length > 0,
      );
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /** Check MR merge status for conflicts. */
  private async isMrMergeable(mrIid: number): Promise<boolean | undefined> {
    try {
      const raw = await this.glab(["api", `projects/:id/merge_requests/${mrIid}?include_rebase_in_progress=true`]);
      const mr = JSON.parse(raw) as { has_conflicts?: boolean; detailed_merge_status?: string };

      if (mr.has_conflicts === true) return false;
      if (mr.detailed_merge_status === "conflict") return false;
      if (mr.detailed_merge_status === "mergeable" || mr.detailed_merge_status === "ci_must_pass") return true;

      return undefined; // Unknown
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /** Check if an MR is approved via the dedicated approvals endpoint. */
  private async isMrApproved(mrIid: number): Promise<boolean> {
    try {
      const raw = await this.glab(["api", `projects/:id/merge_requests/${mrIid}/approvals`]);
      const response: unknown = JSON.parse(raw);
      const data = GitLabApprovalSchema.parse(response);
      // Only trust explicit approvals — ignore bare 'approved' flag.
      // When a project has zero approval rules, GitLab returns approved:true
      // even though nobody has actually reviewed, causing false positives.
      const hasExplicitApproval = Array.isArray(data.approved_by) && data.approved_by.length > 0;

      if (!hasExplicitApproval) return false;

      // All required approvals satisfied
      return (data.approvals_left ?? 1) <= 0;
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /** Merge one exact observed MR within the owning project.
   * @param issueId - Managed issue whose request is selected.
   * @param prUrl - Optional exact previously observed request URL.
   */
  async mergePr(issueId: number, prUrl?: string): Promise<void> {
    const open = await this.selectOpenMr(issueId, prUrl);

    if (!open) throw new Error(`No open MR found for issue #${issueId}`);
    await this.glabOnce(["mr", "merge", String(open.iid)]);
  }

  /** Read one selected MR's diff without replacing an unavailable explicit target.
   * @param issueId - Managed issue whose request is selected.
   * @param prUrl - Optional exact previously observed request URL.
   */
  async getPrDiff(issueId: number, prUrl?: string): Promise<string | null> {
    const open = await this.selectOpenMr(issueId, prUrl);

    if (!open) return null;
    try {
      return await this.glab(["mr", "diff", String(open.iid)]);
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /** Read complete feedback for one selected MR, deduplicating its shared note identities.
   * @param issueId - Managed issue whose request is selected.
   * @param prUrl - Optional exact previously observed request URL.
   */
  async getPrReviewComments(issueId: number, prUrl?: string): Promise<PrReviewComment[]> {
    const open = await this.selectOpenMr(issueId, prUrl);

    if (!open) return [];
    const comments: PrReviewComment[] = [];

    try {
      const discussions = await this.glabCollection(`projects/:id/merge_requests/${open.iid}/discussions`, GitLabDiscussionSchema);

      for (const disc of discussions) {
        for (const note of disc.notes) {
          if (note.system) continue;
          comments.push({
            kind: note.type === GITLAB_INLINE_NOTE_TYPE || note.position ? PR_COMMENT_KIND.INLINE : PR_COMMENT_KIND.CONVERSATION,
            id: note.id,
            author: note.author.username,
            body: note.body,
            state: note.resolvable ? (note.resolved ? "RESOLVED" : "UNRESOLVED") : "COMMENTED",
            created_at: note.created_at,
            path: note.position?.new_path,
            line: note.position?.new_line ?? undefined,
          });
        }
      }
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }

    // Also include top-level conversation notes (regular MR comments, not threaded)
    const conversationNotes = await this.fetchConversationComments(open.iid);

    for (const n of conversationNotes) {
      // Avoid duplicates: discussions endpoint may already include these
      if (!comments.some((c) => c.id === n.id)) {
        comments.push({
          kind: PR_COMMENT_KIND.CONVERSATION,
          id: n.id,
          author: n.author.username,
          body: n.body,
          state: "COMMENTED",
          created_at: n.created_at,
        });
      }
    }

    comments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    return comments;
  }

  /** Create one note without replaying a mutation whose response may have been lost.
   * @param issueId - Provider issue receiving the note.
   * @param body - Complete note text submitted once.
   */
  async addComment(issueId: number, body: string): Promise<number> {
    let raw: string;

    try {
      raw = await this.glabOnce([
        "api", `projects/:id/issues/${issueId}/notes`,
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
        message: "GitLab note creation returned no confirmed comment identity.",
        retryable: false, outcomeUnknown: true, cause: error });
    }
  }

  /**
   * Add an emoji award (reaction) to an MR note/comment.
   * Uses the GitLab Award Emoji API on MR notes.
   * Best-effort — swallows all errors.
   * @param issueId  Used to locate the associated open MR via getRelatedMRs
   * @param commentId  The note ID on the MR
   * @param emoji  Emoji name without colons (e.g. "robot", "thumbsup")
   */
  async reactToIssue(issueId: number, emoji: string): Promise<void> {
    try {
      await this.glabOnce([
        "api", `projects/:id/issues/${issueId}/award_emoji`,
        "--method", "POST",
        "--field", `name=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  async issueHasReaction(issueId: number, emoji: string): Promise<boolean> {
    try {
      const emojis = await this.glabCollection(`projects/:id/issues/${issueId}/award_emoji`, GitLabEmojiSchema);

      return emojis.some((e) => e.name === emoji);
    } catch { return false; }
  }

  async reactToPr(issueId: number, emoji: string): Promise<void> {
    try {
      const mrs = await this.getRelatedMRs(issueId);
      const open = mrs.find((mr) => mr.state === "opened");

      if (!open) return;
      await this.glabOnce([
        "api", `projects/:id/merge_requests/${open.iid}/award_emoji`,
        "--method", "POST",
        "--field", `name=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  async prHasReaction(issueId: number, emoji: string): Promise<boolean> {
    try {
      const mrs = await this.getRelatedMRs(issueId);
      const open = mrs.find((mr) => mr.state === "opened");

      if (!open) return false;
      const emojis = await this.glabCollection(`projects/:id/merge_requests/${open.iid}/award_emoji`, GitLabEmojiSchema);

      return emojis.some((e) => e.name === emoji);
    } catch { return false; }
  }

  async reactToIssueComment(issueId: number, commentId: number, emoji: string): Promise<void> {
    try {
      await this.glabOnce([
        "api", `projects/:id/issues/${issueId}/notes/${commentId}/award_emoji`,
        "--method", "POST",
        "--field", `name=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  async reactToPrComment(issueId: number, commentId: number, emoji: string): Promise<void> {
    try {
      const mrs = await this.getRelatedMRs(issueId);
      const open = mrs.find((mr) => mr.state === "opened");

      if (!open) return;
      await this.glabOnce([
        "api", `projects/:id/merge_requests/${open.iid}/notes/${commentId}/award_emoji`,
        "--method", "POST",
        "--field", `name=${emoji}`,
      ]);
    } catch { /* best-effort */ }
  }

  /** React to an inline review comment using its provider comment namespace.
   * @param issueId - Issue used to resolve the active pull request.
   * @param commentId - Provider inline comment identifier.
   * @param emoji - Provider reaction name.
   */
  async reactToPrReviewComment(issueId: number, commentId: number, emoji: string): Promise<void> {
    await this.reactToPrComment(issueId, commentId, emoji);
  }

  async issueCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    try {
      const emojis = await this.glabCollection(`projects/:id/issues/${issueId}/notes/${commentId}/award_emoji`, GitLabEmojiSchema);

      return emojis.some((e) => e.name === emoji);
    } catch { return false; }
  }

  async prCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    try {
      const mrs = await this.getRelatedMRs(issueId);
      const open = mrs.find((mr) => mr.state === "opened");

      if (!open) return false;
      const emojis = await this.glabCollection(`projects/:id/merge_requests/${open.iid}/notes/${commentId}/award_emoji`, GitLabEmojiSchema);

      return emojis.some((e) => e.name === emoji);
    } catch { return false; }
  }

  /** Check whether an inline review comment already carries the requested reaction.
   * @param issueId - Issue used to resolve the active pull request.
   * @param commentId - Provider inline comment identifier.
   * @param emoji - Provider reaction name.
   */
  async prReviewCommentHasReaction(issueId: number, commentId: number, emoji: string): Promise<boolean> {
    return this.prCommentHasReaction(issueId, commentId, emoji);
  }

  async editIssue(issueId: number, updates: { title?: string; body?: string }): Promise<Issue> {
    const args = ["issue", "update", String(issueId)];

    if (updates.title !== undefined) args.push("--title", updates.title);
    if (updates.body !== undefined) args.push("--description", updates.body);
    await this.glabWrite(args);

    return this.getIssue(issueId);
  }

  /**
   * Check if work for an issue is already present on the base branch via git log.
   * Searches complete reachable history for an exact issue reference; MR numbers are independent identities.
   * Used as a fallback when no MR exists (e.g., direct commit to main).
   * @param issueId - Positive issue identifier to match exactly.
   * @param baseBranch - Configured base branch whose history is inspected.
   */
  async isCommitOnBaseBranch(issueId: number, baseBranch: string): Promise<boolean> {
    try {
      return await hasIssueCommitOnBaseBranch(this.runCommand, this.repoPath, issueId, baseBranch);
    } catch (error) { throw classifyProviderLookupFailure("gitlab", error); }
  }

  /** Publish already saved bytes once; unavailable or unconfirmed uploads leave the local attachment usable.
   * @param issueId - Provider issue identity; GitLab uploads are scoped to its project.
   * @param file - Persisted bytes and untrusted display metadata.
   */
  async uploadAttachment(
    issueId: number,
    file: { filename: string; buffer: Buffer; mimeType: string },
  ): Promise<string | null> {
    try {
      return await uploadGitLabAttachment(this.runCommand, this.repoPath, args => this.glab(args), file.filename, file.buffer);
    } catch { return null; }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.glab(["auth", "status"]);

      return true;
    } catch { return false; }
  }
}
