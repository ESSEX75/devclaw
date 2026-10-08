/** Tests provider pagination, cross-repository filtering and complete feedback through CLI responses. */

import assert from "node:assert/strict";
import { it } from "node:test";

import type { RunCommand } from "../../context.js";
import { PR_COMMENT_KIND } from "./const.js";
import { GitHubProvider } from "./github/index.js";
import { GitLabProvider } from "./gitlab/index.js";
import { isProviderIssueLookupError } from "./errors/index.js";
import { PR_STATE } from "./const.js";

/** Serialize one clean provider CLI response without bypassing transport validation.
 * @param data - Complete paginated or scalar fixture payload.
 */
function response(data: unknown): Awaited<ReturnType<RunCommand>> {
  return { stdout: JSON.stringify(data), stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
}

it("GitHub reads later timeline and review pages and excludes cross-repository references", async () => {
  const calls: string[][] = [];
  const pr = { number: 21, title: "Fix", state: "OPEN", url: "https://github.com/owner/repo/pull/21" };
  const first = { id: 8, user: { login: "reviewer" }, body: "obsolete request", state: "CHANGES_REQUESTED", submitted_at: "2026-01-01" };
  const last = { ...first, id: 9, body: "current approval", state: "APPROVED", submitted_at: "2026-01-02" };
  const inline = { id: 9, user: { login: "reviewer" }, body: "inline", created_at: "2026-01-01" };
  const runCommand: RunCommand = async argv => {
    calls.push([...argv]);
    const endpoint = argv[2]?.split("?")[0];
    if (argv[1] === "repo") return response({ owner: { login: "owner" }, name: "repo" });
    if (endpoint === "graphql") return response([
      { data: { repository: { issue: { timelineItems: { pageInfo: { hasNextPage: true, endCursor: "cursor" },
        nodes: [{ source: { ...pr, number: 99, url: "https://github.com/foreign/repo/pull/99" } }] } } } } },
      { data: { repository: { issue: { timelineItems: { pageInfo: { hasNextPage: false, endCursor: "last" }, nodes: [{ source: pr }] } } } } },
    ]);
    if (endpoint?.endsWith("/reviews")) return response([[first], [last]]);
    if (endpoint?.includes("/pulls/") && endpoint.endsWith("/comments")) return response([[inline], [{ ...inline, id: 10 }]]);
    return response([[]]);
  };
  const provider = new GitHubProvider({ repoPath: ".", runCommand });
  const status = await provider.getPrStatus(42);
  assert.equal(status.url, pr.url);
  assert.equal(status.state, PR_STATE.APPROVED);
  const feedback = await provider.getPrReviewComments(42);
  assert.ok(!feedback.some(comment => comment.body === first.body));
  assert.equal(feedback.filter(comment => comment.kind === PR_COMMENT_KIND.INLINE).length, 2);
  assert.equal(feedback.filter(comment => comment.kind === PR_COMMENT_KIND.REVIEW).length, 1);
  assert.ok(calls.some(argv => argv.includes("--paginate") && argv.includes("--slurp") && argv.some(arg => arg.includes("after: $endCursor"))));
});

it("GitHub fallback searches every page and finds an open request after an older linked closed PR", async () => {
  const closed = { number: 2, title: "old", state: "CLOSED", url: "https://github.com/owner/repo/pull/2" };
  const open = { number: 120, title: "new", state: "OPEN", url: "https://github.com/owner/repo/pull/120" };
  const provider = new GitHubProvider({ repoPath: ".", runCommand: async argv => {
    const endpoint = argv[2]?.split("?")[0];
    if (argv[1] === "repo") return response({ owner: { login: "owner" }, name: "repo" });
    if (endpoint === "graphql") return response([{ data: { repository: { issue: { timelineItems: {
      pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ source: closed }],
    } } } } }]);
    if (endpoint === "repos/:owner/:repo/pulls") return response([
      [{ number: 9, title: "Unrelated #123", body: "", head: { ref: "other" }, html_url: "https://github.com/owner/repo/pull/9" }],
      [{ number: open.number, title: "fix #42", body: "", head: { ref: "feature/42-new" }, html_url: open.url }],
    ]);
    if (argv[1] === "pr") return response(open);
    return response([[]]);
  } });
  assert.equal((await provider.getPrStatus(42)).url, open.url);
});

it("GitHub complete issue pages exclude REST pull-request entries and preserve later issues", async () => {
  const issue = { number: 1, title: "Issue", body: "", labels: [], state: "open", html_url: "https://github.com/owner/repo/issues/1" };
  const provider = new GitHubProvider({ repoPath: ".", runCommand: async () => response([
    [issue], [{ ...issue, number: 2, pull_request: {} }, { ...issue, number: 3 }],
  ]) });
  assert.deepEqual((await provider.listIssues()).map(value => value.iid), [1, 3]);
});

it("GitHub rejects incomplete cursor pagination rather than accepting a prefix", async () => {
  const provider = new GitHubProvider({ repoPath: ".", runCommand: async argv => argv[1] === "repo"
    ? response({ owner: { login: "owner" }, name: "repo" }) : response([{ data: { repository: { issue: { timelineItems: {
      pageInfo: { hasNextPage: true, endCursor: "more" }, nodes: [],
    } } } } }]) });
  await assert.rejects(provider.getPrStatus(42), isProviderIssueLookupError);
});

it("GitLab decodes later discussion pages, keeps inline kind without position and filters foreign project IIDs", async () => {
  const note = { id: 1, author: { username: "reviewer" }, body: "fix", created_at: "2026-01-01", system: false };
  const mr = { iid: 3, project_id: 1, title: "Fix", state: "opened", web_url: "https://gitlab.test/group/repo/-/merge_requests/3" };
  const calls: string[][] = [];
  const runCommand: RunCommand = async argv => {
    calls.push([...argv]);
    const endpoint = argv[2]?.split("?")[0];
    if (endpoint === "projects/:id") return response({ id: 1 });
    if (endpoint?.endsWith("related_merge_requests")) return { ...response([]), stdout: JSON.stringify([mr]) + JSON.stringify([{ ...mr, iid: 99, project_id: 2 }]) };
    if (endpoint?.endsWith("discussions")) return { ...response([]), stdout: JSON.stringify([{ notes: [{ ...note, type: "DiffNote", position: null }] }])
      + JSON.stringify([{ notes: [{ ...note, id: 2, type: "DiscussionNote" }] }]) };
    if (endpoint?.endsWith("notes")) return response([note, { ...note, id: 2 }]);
    return response([]);
  };
  const feedback = await new GitLabProvider({ repoPath: ".", runCommand }).getPrReviewComments(42);
  assert.deepEqual(feedback.map(comment => [comment.id, comment.kind]), [[1, PR_COMMENT_KIND.INLINE], [2, PR_COMMENT_KIND.CONVERSATION]]);
  assert.ok(calls.filter(argv => argv[2]?.includes("merge_requests/")).every(argv => argv[2].includes("merge_requests/3/")));
});
