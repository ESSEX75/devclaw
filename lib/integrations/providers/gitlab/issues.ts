/** Owns GitLab issues operations and their provider-specific API semantics. */

import { z } from "zod";

import {
  classifyProviderLookupFailure, classifyProviderProjectAccessFailure, mayBeMissingProviderIssue,
  PROVIDER_ISSUE_LOOKUP_ERROR, ProviderIssueLookupError,
} from "../lookup-errors.js";
import { classifyProviderOperationError, PROVIDER_OPERATION_ERROR, ProviderOperationError } from "../operation-errors.js";
import type {
  CreateIssueInput,
  Issue,
  IssueComment,
  IssueEditInput,
  IssueListFilter,
  ProviderTransport,
  StateLabel,
} from "../types.js";
import { GitLabIssueSchema, GitLabNoteSchema } from "./schema.js";

/** Implements the issues capability using dependencies shared by one adapter instance. */
export class GitLabIssues {
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   */
  constructor(private readonly transport: ProviderTransport) {}

  /** Submit one issue creation; an unidentified or lost response never authorizes replay.
     * @param input - Complete application-selected issue payload for one creation attempt.
     */
  async createIssue(input: CreateIssueInput): Promise<Issue> {
      try {
        // Pass description directly as argv — runCommand uses spawn (no shell),
        // so no escaping issues with special characters.
        const args = ["issue", "create", "--title", input.title, "--description", input.body];

        if (input.labels.length) args.push("--label", input.labels.join(","));
        if (input.assignees.length) args.push("--assignee", input.assignees.join(","));
        const stdout = await this.transport.once(args);
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
  async listIssues(opts?: IssueListFilter): Promise<Issue[]> {
    const state = opts?.state === "open" || opts?.state === undefined ? "opened" : opts.state;
    const label = opts?.label ? `&labels=${encodeURIComponent(opts.label)}` : "";

    return this.transport.collection(`projects/:id/issues?state=${state}${label}`, GitLabIssueSchema);
  }

  /** Read a validated issue, distinguishing missing identity from failed repository access.
     * @param issueId - Provider-local issue identity within the configured repository.
     */
  async getIssue(issueId: number): Promise<Issue> {
      try {
        const raw = await this.transport.read(["issue", "view", String(issueId), "--output", "json"]);
        const parsed: unknown = JSON.parse(raw);

        return GitLabIssueSchema.parse(parsed);
      } catch (error) {
        if (mayBeMissingProviderIssue(error)) {
          try {
            await this.transport.read(["repo", "view", "--output", "json"]);
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
    const notes = await this.transport.collection(`projects/:id/issues/${issueId}/notes`, GitLabNoteSchema);

    return notes.filter(note => !note.system).map(note => ({ id: note.id, author: note.author.username, body: note.body, created_at: note.created_at }));
  }

  /** Apply an explicitly selected closed state idempotently.
     * @param issueId - Provider-local issue identity within the configured repository.
     */
  async closeIssue(issueId: number): Promise<void> { await this.transport.write(["issue", "close", String(issueId)]); }

  /** Apply an explicitly selected open state idempotently.
     * @param issueId - Provider-local issue identity within the configured repository.
     */
  async reopenIssue(issueId: number): Promise<void> { await this.transport.write(["issue", "reopen", String(issueId)]); }

  /** Declare whether the concrete adapter supports explicit issue deletion.
     */
  supportsIssueDeletion(): boolean { return true; }

  /** Delete once; abnormal completion never proves successful deletion.
   * @param issueId - Provider identity explicitly selected for deletion.
   */
  async deleteIssue(issueId: number): Promise<void> {
    await this.transport.once(["api", `projects/:id/issues/${issueId}`, "--method", "DELETE"]);
  }

  /** Create one note without replaying a mutation whose response may have been lost.
   * @param issueId - Provider issue receiving the note.
   * @param body - Complete note text submitted once.
   */
  async addComment(issueId: number, body: string): Promise<number> {
    let raw: string;

    try {
      raw = await this.transport.once([
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

  /** Apply explicit title/body edits and return the subsequent validated issue observation.
     * @param issueId - Provider-local issue identity within the configured repository.
     * @param updates - Explicit title and body fields selected for provider mutation.
     */
  async editIssue(issueId: number, updates: IssueEditInput): Promise<Issue> {
      const args = ["issue", "update", String(issueId)];

      if (updates.title !== undefined) args.push("--title", updates.title);
      if (updates.body !== undefined) args.push("--description", updates.body);
      await this.transport.write(args);

      return this.getIssue(issueId);
    }
}
