/** Tests provider transport recovery, retry isolation and conservative mutation outcomes through public operations. */

import assert from "node:assert/strict";
import { it } from "node:test";

import type { RunCommand } from "../../../context.js";
import { createProvider } from "../index.js";
import { GitHubProvider } from "../github/index.js";
import { GitLabProvider } from "../gitlab/index.js";
import { isProviderIssueLookupError } from "../errors/index.js";
import { classifyProviderOperationError } from "../errors/index.js";
import { isProviderOperationError } from "../errors/index.js";
import { classifyProviderLookupFailure } from "../errors/index.js";
import { runProviderCommand } from "./command.js";
import { PROVIDER_COMMAND_MODE } from "./const.js";
import { createProviderPolicy, withResilience } from "./resilience.js";

/** Clean command response for deterministic transport fixtures.
 * @param stdout - External output to deliver to the adapter.
 */
function success(stdout: string): Awaited<ReturnType<RunCommand>> {
  return { stdout, stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
}

for (const Provider of [GitHubProvider, GitLabProvider]) {
  it(`${Provider.name} does not report a pending PR when required review observations fail`, async () => {
    const runCommand: RunCommand = async argv => {
      if (argv[1] === "repo") return success('{"owner":{"login":"owner"},"name":"repo"}');
      if (argv[2] === "graphql") return success(JSON.stringify({ data: { repository: { issue: { timelineItems: { nodes: [{
        source: { number: 7, title: "Fix", body: "", headRefName: "feature/42-fix", url: "https://example.test/pr/7", state: "OPEN" },
      }] } } } } }));
      if (argv[2] === "projects/:id") return success('{"id":1}');
      if (argv[2]?.split("?")[0]?.endsWith("related_merge_requests")) return success('[{"iid":7,"project_id":1,"title":"Fix","web_url":"https://example.test/mr/7","state":"opened"}]');
      return { ...success("[]"), code: 1, stderr: "HTTP 401 Unauthorized" };
    };
    await assert.rejects(new Provider({ repoPath: ".", runCommand }).getPrStatus(42), isProviderIssueLookupError);
  });

  it(`${Provider.name} keeps unidentified creation unknown and never automatically repeats it`, async () => {
    let calls = 0;
    const provider = new Provider({ repoPath: ".", runCommand: async () => { calls++; return success("unexpected creation response"); } });
    await assert.rejects(provider.createIssue({ title: "t", body: "b", labels: [], assignees: [] }), error =>
      isProviderOperationError(error) && error.outcomeUnknown && !error.retryable);
    assert.equal(calls, 1);
  });

  it(`${Provider.name} distinguishes a failed PR lookup from an empty successful lookup`, async () => {
    let fail = true;
    let calls = 0;
    const runCommand: RunCommand = async argv => {
      calls++;
      if (fail) return { ...success("[]"), code: 1, stderr: "HTTP 401 Unauthorized" };
      if (argv[1] === "repo") return success('{"owner":{"login":"owner"},"name":"repo"}');
      if (argv[2] === "graphql") return success('[{"data":{"repository":{"issue":{"timelineItems":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}}}]');
      return success(Provider === GitHubProvider ? "[[]]" : "[]");
    };
    const provider = new Provider({ repoPath: ".", runCommand });
    for (let attempt = 0; attempt < 6; attempt++) {
      await assert.rejects(provider.getPrStatus(42), error => isProviderIssueLookupError(error) && error.code === "UNAUTHORIZED");
    }
    assert.equal(calls, 6, "permanent failures must neither retry nor open the breaker");
    fail = false;
    const status = await provider.getPrStatus(42);
    assert.equal(status.url, null, "a successful empty response establishes absence");
  });

  it(`${Provider.name} retries a temporary read but submits creation only once`, async () => {
    let calls = 0;
    const runCommand: RunCommand = async () => {
      calls++;
      if (calls === 1) return { ...success(""), code: 1, stderr: "HTTP 503 Service unavailable" };
      return success(Provider === GitHubProvider ? "[[]]" : "[]");
    };
    const provider = new Provider({ repoPath: ".", runCommand });
    assert.deepEqual(await provider.listIssues(), []);
    assert.equal(calls, 2);
    calls = 0;
    await assert.rejects(provider.createIssue({ title: "t", body: "b", labels: [], assignees: [] }), error =>
      isProviderOperationError(error) && error.outcomeUnknown);
    assert.equal(calls, 1);
  });

  it(`${Provider.name} cannot confirm deletion from an abnormal process with successful-looking output`, async () => {
    const provider = new Provider({ repoPath: ".", runCommand: async () => ({ ...success("deleted"), killed: true, termination: "timeout" }) });
    await assert.rejects(provider.deleteIssue(42), error => isProviderOperationError(error) && error.outcomeUnknown);
  });

  it(`${Provider.name} does not infer issue absence from an uncertain exception mentioning 404`, async () => {
    let calls = 0;
    const provider = new Provider({ repoPath: ".", runCommand: async () => {
      calls++;
      throw new Error("lost process response: HTTP 404 not found");
    } });
    await assert.rejects(provider.getIssue(42), error => isProviderIssueLookupError(error) && error.code !== "ISSUE_NOT_FOUND");
    assert.equal(calls, 1, "unknown completion cannot authorize a repository-access proof of absence");
  });
}

it("isolates open breakers between independent adapters and bypasses retry for creation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const broken = createProviderPolicy();
  const healthy = createProviderPolicy();
  let attempts = 0;
  for (let failure = 0; failure < 5; failure++) {
    const failed = assert.rejects(withResilience(PROVIDER_COMMAND_MODE.READ, broken, async () => {
      attempts++;
      throw new Error("network failure");
    }));
    for (let retry = 0; retry < 5; retry++) {
      await new Promise<void>(resolve => setImmediate(resolve));
      t.mock.timers.runAll();
    }
    await failed;
  }
  const count = attempts;
  await assert.rejects(withResilience(PROVIDER_COMMAND_MODE.READ, broken, async () => { attempts++; return "unexpected"; }));
  assert.equal(attempts, count);
  assert.equal(await withResilience(PROVIDER_COMMAND_MODE.READ, healthy, async () => "healthy"), "healthy");
});

it("preserves consistent rate-limit and response-loss semantics across lookup and mutation classification", () => {
  const rate = new Error("HTTP 403 API rate limit exceeded");
  assert.equal(classifyProviderLookupFailure("github", rate).code, "RATE_LIMITED");
  assert.equal(classifyProviderOperationError(rate).code, "RATE_LIMITED");
  const lost = new Error("timeout after an earlier HTTP 422 response");
  assert.equal(classifyProviderLookupFailure("github", lost).code, "TRANSIENT");
  assert.equal(classifyProviderOperationError(lost).outcomeUnknown, true);
});

it("an exhausted adapter does not block another repository and recovers after the cooldown", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  let fail = true;
  let calls = 0;
  const failing = new GitHubProvider({ repoPath: "broken-repo", runCommand: async () => {
    calls++;
    return fail ? { ...success(""), code: 1, stderr: "HTTP 503" } : success("[[]]");
  } });
  for (let attempt = 0; attempt < 5; attempt++) {
    const rejected = assert.rejects(failing.listIssues());
    for (let retry = 0; retry < 5; retry++) {
      await new Promise<void>(resolve => setImmediate(resolve));
      t.mock.timers.runAll();
    }
    await rejected;
  }
  const count = calls;
  await assert.rejects(failing.listIssues());
  assert.equal(calls, count);
  const independent = new GitHubProvider({ repoPath: "healthy-repo", runCommand: async () => success("[[]]") });
  assert.deepEqual(await independent.listIssues(), []);
  fail = false;
  t.mock.timers.tick(31_000);
  assert.deepEqual(await failing.listIssues(), []);
});

it("GitHub repository identity is retried after an exhausted transient observation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let fail = true;
  const provider = new GitHubProvider({ repoPath: ".", runCommand: async argv => {
    if (fail) return { ...success(""), code: 1, stderr: "HTTP 503" };
    if (argv[1] === "repo") return success('{"owner":{"login":"owner"},"name":"repo"}');
    if (argv[2] === "graphql") return success('[{"data":{"repository":{"issue":{"timelineItems":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}}}]');
    return success("[[]]");
  } });
  const rejected = assert.rejects(provider.getPrStatus(42), error => isProviderIssueLookupError(error) && error.retryable);
  for (let retry = 0; retry < 5; retry++) {
    await new Promise<void>(resolve => setImmediate(resolve));
    t.mock.timers.runAll();
  }
  await rejected;
  fail = false;
  assert.equal((await provider.getPrStatus(42)).url, null);
});

it("partial GraphQL results cannot establish that no PR exists", async () => {
  const provider = new GitHubProvider({ repoPath: ".", runCommand: async argv =>
    success(argv[1] === "repo" ? '{"owner":{"login":"owner"},"name":"repo"}' : '{"data":null,"errors":[{"message":"unavailable"}]}') });
  await assert.rejects(provider.getPrStatus(42), isProviderIssueLookupError);
});

it("GitLab label creation follows only confirmed absence, never a lost update response", async () => {
  let calls = 0;
  const provider = new GitLabProvider({ repoPath: ".", runCommand: async () => {
    calls++;
    return { ...success(""), code: 1, stderr: "HTTP 401" };
  } });
  await assert.rejects(provider.ensureLabel("Doing", "#abcdef"));
  assert.equal(calls, 1);
});

it("ignores reassuring stderr when completion is abnormal and does not include secret argv in errors", async () => {
  const runCommand: RunCommand = async () => ({ ...success("created"), stderr: "HTTP 401", killed: true, termination: "timeout" });
  await assert.rejects(runProviderCommand(runCommand, ["cli", "secret"], "."), error => {
    const classified = classifyProviderOperationError(error);
    assert.equal(classified.outcomeUnknown, true);
    assert.equal(classified.code, "TRANSIENT");
    assert.ok(!classified.message.includes("secret"));
    return true;
  });
});

it("detects exact known hosts and requires explicit selection for unknown or self-hosted origins", async () => {
  for (const [remote, expected] of [["git@github.com:owner/repo.git", "github"], ["https://gitlab.com/group/repo.git", "gitlab"]]) {
    const result = await createProvider({ repoPath: ".", runCommand: async () => success(remote) });
    assert.equal(result.type, expected);
  }
  for (const remote of ["https://github.com.attacker.test/owner/repo", "git@code.example:group/repo", "local/path", ""]) {
    await assert.rejects(createProvider({ repoPath: ".", runCommand: async () => success(remote) }), /specify.*provider explicitly/);
  }
  await assert.rejects(createProvider({ repoPath: ".", runCommand: async () => ({ ...success(""), code: 128, stderr: "missing origin" }) }));
  let calls = 0;
  const explicit = await createProvider({ provider: "gitlab", repoPath: ".", runCommand: async () => { calls++; throw new Error("must not detect"); } });
  assert.equal(explicit.type, "gitlab");
  assert.equal(calls, 0);
});
