/** Tests review resource identity at real provider adapters with deterministic CLI responses. */

import assert from "node:assert/strict";
import { it } from "node:test";
import type { RunCommand } from "../../context.js";
import { PR_COMMENT_KIND } from "./const.js";
import { GitHubProvider } from "./github.js";
import { GitLabProvider } from "./gitlab.js";

it("GitHub keeps review, inline and conversation IDs separate and uses the inline reaction endpoint", async () => {
  const calls: string[][] = [];
  const runCommand: RunCommand = async (argv) => {
    calls.push([...argv]);
    const comment = { id: 42, user: { login: "reviewer" }, body: "fix", state: "COMMENTED", created_at: "2026-01-01", submitted_at: "2026-01-01" };
    let data: unknown = [];
    if (argv[1] === "repo") data = { owner: { login: "owner" }, name: "repo" };
    else if (argv[2] === "graphql") data = { data: { repository: { issue: { timelineItems: { nodes: [] } } } } };
    else if (argv[1] === "pr") data = [{ number: 7, title: "Fix #1", body: "", headRefName: "feature/1-fix" }];
    else if (argv[2]?.endsWith("/reactions")) data = [{ content: "eyes" }];
    else if (argv[1] === "api") data = [comment];
    return { stdout: JSON.stringify(data), stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
  };
  const provider = new GitHubProvider({ repoPath: ".", runCommand });
  const comments = await provider.getPrReviewComments(1);
  assert.deepEqual(comments.map(({ kind, id }) => ({ kind, id })), [
    { kind: PR_COMMENT_KIND.REVIEW, id: 42 },
    { kind: PR_COMMENT_KIND.INLINE, id: 42 },
    { kind: PR_COMMENT_KIND.CONVERSATION, id: 42 },
  ]);
  assert.equal(await provider.prReviewCommentHasReaction(1, 42, "eyes"), true);
  await provider.reactToPrReviewComment(1, 42, "eyes");
  assert.deepEqual(calls.slice(-2), [
    ["gh", "api", "repos/:owner/:repo/pulls/comments/42/reactions"],
    ["gh", "api", "repos/:owner/:repo/pulls/comments/42/reactions", "--method", "POST", "--field", "content=eyes"],
  ]);
});

it("GitLab preserves inline identity, deduplicates discussion notes and reacts through MR notes", async () => {
  const calls: string[][] = [];
  const runCommand: RunCommand = async (argv) => {
    calls.push([...argv]);
    const note = { id: 42, author: { username: "reviewer" }, body: "fix", created_at: "2026-01-01", system: false };
    let data: unknown = [];
    if (argv[2]?.endsWith("related_merge_requests")) data = [{ iid: 7, state: "opened", title: "Fix", web_url: "https://gitlab.test/mr/7" }];
    else if (argv[2]?.endsWith("discussions")) data = [{ notes: [{ ...note, position: { new_path: "file.ts" } }] }];
    else if (argv[2]?.endsWith("notes")) data = [note, { ...note, id: 43 }];
    else if (argv[2]?.endsWith("award_emoji")) data = [{ name: "eyes" }];
    return { stdout: JSON.stringify(data), stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
  };
  const provider = new GitLabProvider({ repoPath: ".", runCommand });
  assert.deepEqual((await provider.getPrReviewComments(1)).map(({ id, kind }) => ({ id, kind })), [
    { id: 42, kind: PR_COMMENT_KIND.INLINE }, { id: 43, kind: PR_COMMENT_KIND.CONVERSATION },
  ]);
  assert.equal(await provider.prReviewCommentHasReaction(1, 42, "eyes"), true);
  await provider.reactToPrReviewComment(1, 42, "eyes");
  assert.deepEqual(calls.at(-1), ["glab", "api", "projects/:id/merge_requests/7/notes/42/award_emoji", "--method", "POST", "--field", "name=eyes"]);
});
