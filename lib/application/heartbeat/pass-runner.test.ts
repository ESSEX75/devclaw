/** Verifies heartbeat ordering, retained partial results, and project isolation. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { HEARTBEAT_PASS_FAILURE_POLICY } from "./const.js";
import { runHeartbeatPasses } from "./pass-runner.js";
import type { HeartbeatPassReport } from "./types.js";

it("retains completed passes and stops a failed project without blocking the next project", async () => {
  const reports: HeartbeatPassReport[] = [];
  const calls: string[] = [];
  assert.equal(await runHeartbeatPasses("first", [
    { name: "one", run: async () => { calls.push("one"); } },
    { name: "two", run: async () => { throw new Error("provider unavailable"); } },
    { name: "three", run: async () => { calls.push("three"); } },
  ], reports), false);
  assert.equal(await runHeartbeatPasses("second", [
    { name: "one", run: async () => { calls.push("second"); } },
  ], reports), true);
  assert.deepEqual(calls, ["one", "second"]);
  assert.equal(reports[0]?.appliedActions.length, 1);
  assert.deepEqual(reports[1]?.errors, ["provider unavailable"]);
  assert.equal(reports[1]?.appliedActions.length, 0);
  assert.equal(reports[2]?.projectSlug, "second");
});

it("continues independent workflow passes and retains each failure", async () => {
  const reports: HeartbeatPassReport[] = [];
  const calls: string[] = [];

  assert.equal(await runHeartbeatPasses("project", [
    { name: "review", run: async () => { calls.push("review"); throw new Error("PR read failed"); } },
    { name: "review_skip", run: async () => { calls.push("review_skip"); } },
    { name: "test_skip", run: async () => { calls.push("test_skip"); throw new Error("close failed"); } },
  ], reports, HEARTBEAT_PASS_FAILURE_POLICY.CONTINUE), false);
  assert.deepEqual(calls, ["review", "review_skip", "test_skip"]);
  assert.deepEqual(reports.map((report) => report.errors), [["PR read failed"], [], ["close failed"]]);
  assert.deepEqual(reports[1]?.appliedActions, [{ kind: "review_skip" }]);
});

it("reports applied health actions separately from failures and resets results for the next tick", async () => {
  const reports: HeartbeatPassReport[] = [];
  const issue = { type: "session_dead", severity: "critical", project: "project", projectSlug: "project", role: "developer", message: "dead" } as const;
  assert.equal(await runHeartbeatPasses("project", [{ name: "health", run: async () => [
    { issue, fixed: true, plannedAction: "requeue" },
    { issue, fixed: false, plannedAction: "requeue", error: "write failed" },
  ] }], reports), false);
  assert.equal(reports[0]?.findings.length, 2);
  assert.equal(reports[0]?.plannedActions.length, 2);
  assert.equal(reports[0]?.appliedActions.length, 1);
  const next: HeartbeatPassReport[] = [];
  assert.equal(await runHeartbeatPasses("project", [{ name: "health", run: async () => [] }], next), true);
  assert.equal(next[0]?.appliedActions.length, 0);
  assert.equal(next[0]?.errors.length, 0);
});
