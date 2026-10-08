/** Exercises malformed and mismatched provider identities and preserves response-loss evidence through classification. */

import assert from "node:assert/strict";
import { it } from "node:test";
import { z } from "zod";

import type { RunCommand } from "../../context.js";
import { runProviderCommand } from "./transport/index.js";
import { normalizeProviderFailure } from "./errors/index.js";
import { GitHubProvider } from "./github/index.js";
import { GitLabProvider } from "./gitlab/index.js";
import { isProviderIssueLookupError } from "./errors/index.js";
import { PROVIDER_ISSUE_LOOKUP_ERROR, PROVIDER_OPERATION_ERROR } from "./errors/index.js";

/** Clean process evidence reused to vary untrusted provider response content.
 * @param stdout - External command JSON to deliver to the adapter.
 */
function completed(stdout: string): Awaited<ReturnType<RunCommand>> {
  return { stdout, stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
}

for (const Provider of [GitHubProvider, GitLabProvider]) {
  for (const identity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 404]) {
    it(`${Provider.name} rejects issue identity ${identity} instead of accepting another issue or proving absence`, async () => {
      let calls = 0;
      const provider = new Provider({ repoPath: ".", runCommand: async () => {
        calls++;
        return completed(JSON.stringify(Provider === GitHubProvider
          ? { number: identity, title: "Issue", body: "", state: "OPEN", labels: [], url: "https://git.test/team/repo/issues/42" }
          : { iid: identity, title: "Issue", description: "", state: "opened", labels: [], web_url: "https://git.test/team/repo/issues/42" }));
      } });
      await assert.rejects(provider.getIssue(42), error => isProviderIssueLookupError(error)
        && error.code === PROVIDER_ISSUE_LOOKUP_ERROR.UNKNOWN && !error.retryable);
      assert.equal(calls, 1, "invalid response content must not trigger an issue-not-found access probe");
    });
  }
}

it("does not interpret HTTP-like numbers in local schema or JSON decoding errors as provider rejections", () => {
  let schemaError: unknown;
  try { z.object({ "404": z.number() }).parse({}); } catch (error) { schemaError = error; }
  for (const error of [schemaError, new SyntaxError("Malformed JSON near HTTP 401")]) {
    assert.deepEqual(normalizeProviderFailure(error), { code: PROVIDER_OPERATION_ERROR.UNKNOWN, retryable: false, outcomeUnknown: true });
  }
});

it("rejects clipped valid JSON and clipped 404 diagnostics as an unknown submitted command outcome", async () => {
  for (const result of [
    { ...completed("[]"), stdoutTruncatedBytes: 10 },
    { ...completed(""), code: 1, stderr: "HTTP 404 Not Found", stderrTruncatedBytes: 10 },
    { ...completed("[]"), outputErrorStream: "stdout" },
  ] satisfies Awaited<ReturnType<RunCommand>>[]) {
    let calls = 0;
    await assert.rejects(runProviderCommand(async () => { calls++; return result; }, ["gh", "api", "issues"], "."), error => {
      const failure = normalizeProviderFailure(error);
      return failure.code === PROVIDER_OPERATION_ERROR.TRANSIENT && failure.outcomeUnknown;
    });
    assert.equal(calls, 1);
  }
});
