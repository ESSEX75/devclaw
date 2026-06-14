/**
 * Tests for sprint-mode reinit readiness.
 *
 * Run: npx tsx --test lib/setup/sprint-readiness.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { TestProvider } from "../testing/test-provider.js";
import type { ResolvedConfig } from "../config/index.js";
import { DEFAULT_WORKFLOW, ReviewPolicy, TaskMode } from "../workflow/index.js";
import {
  assertSprintReady,
  checkSprintReinitReadiness,
  runSprintReadinessWritePhase,
  SprintReinitState,
} from "./sprint-readiness.js";

function config(overrides?: {
  taskMode?: TaskMode;
  reviewPolicy?: ReviewPolicy;
}): ResolvedConfig {
  return {
    workflow: {
      ...DEFAULT_WORKFLOW,
      taskMode: overrides?.taskMode ?? TaskMode.SPRINT,
      reviewPolicy: overrides?.reviewPolicy ?? ReviewPolicy.HUMAN,
    },
    roles: {},
    timeouts: {
      gitPullMs: 1,
      gatewayMs: 1,
      sessionPatchMs: 1,
      dispatchMs: 1,
      staleWorkerHours: 1,
      sessionContextBudget: 0.6,
      stallTimeoutMinutes: 15,
    },
  };
}

const project = { baseBranch: "main" };

describe("sprint reinit readiness", () => {
  it("returns ready with provider warnings and no created resources before writes", async () => {
    const provider = new TestProvider();
    provider.sprintReadiness.warnings = [{
      code: "native_dependencies_unavailable",
      message: "Dependency relationships unavailable.",
    }];

    const result = await checkSprintReinitReadiness({
      provider,
      project,
      config: config(),
    });

    assert.strictEqual(result.state, SprintReinitState.READY);
    assert.deepStrictEqual(result.blocking, []);
    assert.strictEqual(result.warnings.length, 1);
    assert.deepStrictEqual(result.created, []);
  });

  it("returns reinit_failed and prevents write phase on blocking provider checks", async () => {
    const provider = new TestProvider();
    provider.sprintReadiness.blocking = [{
      code: "provider_permissions",
      message: "Missing branch permission.",
    }];

    const readiness = await checkSprintReinitReadiness({
      provider,
      project,
      config: config(),
    });
    const writeResult = await runSprintReadinessWritePhase({
      readiness,
      write: async () => {
        await provider.ensureLabel("should-not-run", "#000000");
      },
    });

    assert.strictEqual(readiness.state, SprintReinitState.REINIT_FAILED);
    assert.strictEqual(writeResult.state, SprintReinitState.REINIT_FAILED);
    assert.strictEqual(provider.callsTo("ensureLabel").length, 0);
    assert.deepStrictEqual(writeResult.created, []);
  });

  it("maps missing mandatory provider capabilities to reinit_failed", async () => {
    const provider = new TestProvider();
    provider.sprintCapabilities.branches = false;

    const result = await checkSprintReinitReadiness({
      provider,
      project,
      config: config(),
    });

    assert.strictEqual(result.state, SprintReinitState.REINIT_FAILED);
    assert.match(result.blocking[0]?.message ?? "", /branches/);
  });

  it("blocks sprint/skip review policy when auto-merge support is unavailable", async () => {
    const provider = new TestProvider();
    provider.sprintCapabilities.autoMerge = false;

    const result = await checkSprintReinitReadiness({
      provider,
      project,
      config: config({ reviewPolicy: ReviewPolicy.SPRINT }),
    });

    assert.strictEqual(result.state, SprintReinitState.REINIT_FAILED);
    assert.ok(result.blocking.some((item) => item.code === "auto_merge_blocked"));
  });

  it("returns reinit_partial when write phase fails after a partial write", async () => {
    const provider = new TestProvider();
    const readiness = await checkSprintReinitReadiness({
      provider,
      project,
      config: config(),
    });

    const result = await runSprintReadinessWritePhase({
      readiness,
      write: async (recordCreated) => {
        await provider.ensureLabel("Planning", "#000000");
        recordCreated({ type: "label", id: "Planning" });
        throw new Error("network timeout");
      },
    });

    assert.strictEqual(result.state, SprintReinitState.REINIT_PARTIAL);
    assert.deepStrictEqual(result.created, [{ type: "label", id: "Planning" }]);
    assert.match(result.blocking[0]?.message ?? "", /network timeout/);
  });

  it("does not call provider readiness checks for issue mode", async () => {
    const provider = new TestProvider();

    const result = await checkSprintReinitReadiness({
      provider,
      project,
      config: config({ taskMode: TaskMode.ISSUE }),
    });

    assert.strictEqual(result.state, SprintReinitState.READY);
    assert.strictEqual(provider.callsTo("checkSprintReadiness").length, 0);
    assert.strictEqual(provider.callsTo("getSprintCapabilities").length, 0);
  });

  it("throws a sprint_create guard error for non-ready reinit state", async () => {
    const provider = new TestProvider();
    provider.sprintReadiness.blocking = [{
      code: "base_branch_missing",
      message: "Base branch missing.",
    }];

    const result = await checkSprintReinitReadiness({
      provider,
      project,
      config: config(),
    });

    assert.throws(() => assertSprintReady(result), /Sprint mode is not ready/);
  });
});
