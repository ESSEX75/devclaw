/** Exercises saved policies, custom routing, and atomic cross-role queue reservations. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { DEFAULT_WORKFLOW, emptySlot, EXECUTION_MODE, ISSUE_INTEGRITY_STATUS, ISSUE_PROVIDER,
  type IssueRuntimeState, REVIEW_POLICY, TEST_POLICY } from "../../domain/index.js";
import { PROVIDER_ISSUE_LOOKUP_ERROR, ProviderIssueLookupError } from "../../integrations/providers/index.js";
import { DATA_DIR, loadConfig, readIssueStateStore } from "../../state/index.js";
import { createTestHarness, createEmptyIssueStateStoreForTesting, replaceIssueStateStoreForTesting } from "../../testing/index.js";
import { QUEUE_REASON } from "./const.js";
import { planQueuePickup } from "./plan.js";
import { findNextIssueForRole } from "./scan.js";
import { projectTick } from "./tick.js";

/** Workspace configuration fixture name; production path ownership remains in state. */
const CONFIG_FIXTURE = "workflow.yaml";

/** Build a complete locally managed queue record.
 * @param projectSlug - Harness project identity.
 * @param issueId - Provider-local identifier.
 * @param overrides - Saved workflow and policy values for the scenario.
 */
function queued(projectSlug: string, issueId: number, overrides: Partial<IssueRuntimeState> = {}): IssueRuntimeState {
  return { projectSlug, issueId, provider: ISSUE_PROVIDER.GITHUB, workflowState: "todo", workflowLabel: "To Do",
    assignedRole: "developer", assignedLevel: "medior", owner: null, reviewPolicy: null, testPolicy: null,
    notifyTarget: null, activeWorker: null, integrityStatus: ISSUE_INTEGRITY_STATUS.OK, integrityErrors: [],
    createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z", closedAt: null,
    providerMissing: null, pipelineNotification: null, ...overrides };
}

/** Seed authoritative and provider snapshots with deliberately unhelpful provider labels.
 * @param harness - Isolated workspace and provider.
 * @param records - Complete locally authoritative candidates.
 */
async function seed(harness: Awaited<ReturnType<typeof createTestHarness>>, records: IssueRuntimeState[]): Promise<void> {
  const store = createEmptyIssueStateStoreForTesting(harness.project.slug);

  for (const record of records) {
    store.issues[String(record.issueId)] = record;
    harness.provider.seedIssue({ iid: record.issueId, title: "Implement task", labels: [record.workflowLabel, "review:skip", "test:skip"] });
  }

  await replaceIssueStateStoreForTesting(harness.workspaceDir, harness.project.slug, store);
}

describe("queue scheduling guarantees", () => {
  it("selects policies per issue before ordering and ignores changed configuration defaults", async () => {
    const harness = await createTestHarness();

    try {
      for (const configured of Object.values(REVIEW_POLICY)) {
        for (const saved of [...Object.values(REVIEW_POLICY), null]) {
          await seed(harness, [queued(harness.project.slug, 1, { workflowState: "toReview", workflowLabel: "To Review", reviewPolicy: saved }),
            queued(harness.project.slug, 2, { workflowState: "toReview", workflowLabel: "To Review", reviewPolicy: REVIEW_POLICY.AGENT })]);
          const result = await projectTick({ workspaceDir: harness.workspaceDir, projectSlug: harness.project.slug,
            provider: harness.provider, workflow: { ...harness.workflow, reviewPolicy: configured }, targetRole: "reviewer", dryRun: true });

          assert.equal(result.pickups[0]?.issueId, saved === REVIEW_POLICY.AGENT || saved === null ? 1 : 2);
        }
      }

      for (const configured of Object.values(TEST_POLICY)) {
        for (const saved of [...Object.values(TEST_POLICY), null]) {
          await seed(harness, [queued(harness.project.slug, 3, { workflowState: "toTest", workflowLabel: "To Test", testPolicy: saved }),
            queued(harness.project.slug, 4, { workflowState: "toTest", workflowLabel: "To Test", testPolicy: TEST_POLICY.AGENT })]);
          const result = await projectTick({ workspaceDir: harness.workspaceDir, projectSlug: harness.project.slug,
            provider: harness.provider, workflow: { ...harness.workflow, testPolicy: configured }, targetRole: "tester", dryRun: true });

          assert.equal(result.pickups[0]?.issueId, saved === TEST_POLICY.SKIP ? 4 : 3);
        }
      }

      assert.equal(harness.commands.taskMessages().length, 0);
      assert.equal(harness.provider.callsTo("transitionLabel").length, 0);
    } finally { await harness.cleanup(); }
  });

  it("preserves agent and null policy snapshots through real dispatch", async () => {
    for (const policy of [REVIEW_POLICY.AGENT, null]) {
      const harness = await createTestHarness();

      try {
        await seed(harness, [queued(harness.project.slug, 1, { reviewPolicy: policy, testPolicy: policy })]);
        const result = await projectTick({ workspaceDir: harness.workspaceDir, projectSlug: harness.project.slug,
          provider: harness.provider, runCommand: harness.runCommand, targetRole: "developer" });
        const state = (await readIssueStateStore(harness.workspaceDir, harness.project.slug)).issues["1"];

        assert.equal(result.pickups.length, 1);
        assert.equal(state?.reviewPolicy, policy);
        assert.equal(state?.testPolicy, policy);
        assert.ok(state?.activeWorker);
      } finally { await harness.cleanup(); }
    }
  });

  it("retains lookup classifications in tick results and propagates them from queries", async () => {
    const harness = await createTestHarness();

    try {
      await seed(harness, [queued(harness.project.slug, 1)]);
      for (const code of [PROVIDER_ISSUE_LOOKUP_ERROR.UNAUTHORIZED, PROVIDER_ISSUE_LOOKUP_ERROR.TRANSIENT, PROVIDER_ISSUE_LOOKUP_ERROR.ISSUE_NOT_FOUND]) {
        const failure = new ProviderIssueLookupError({ code, provider: "github", retryable: false, message: `Provider failure ${code}` });

        harness.provider.getIssue = async () => { throw failure; };
        await assert.rejects(findNextIssueForRole(harness.provider, "developer", harness.workflow, undefined,
          { workspaceDir: harness.workspaceDir, projectSlug: harness.project.slug }), error => error === failure);
        const result = await projectTick({ workspaceDir: harness.workspaceDir, projectSlug: harness.project.slug,
          provider: harness.provider, targetRole: "developer", dryRun: true });

        assert.equal(result.pickups.length, 0);
        assert.equal(result.skipped[0]?.code, code);
        assert.match(result.skipped[0]?.reason ?? "", /Provider failure/);
      }
    } finally { await harness.cleanup(); }
  });

  it("atomically excludes a concurrent different-role reservation before provider effects", async () => {
    const harness = await createTestHarness();
    let release = () => {};
    const ready = new Promise<void>(resolve => { release = resolve; });
    let arrivals = 0;
    const listComments = harness.provider.listComments.bind(harness.provider);

    harness.provider.listComments = async (...args) => {
      arrivals++;
      if (arrivals === 2) release();
      await ready;

      return listComments(...args);
    };

    try {
      await seed(harness, [queued(harness.project.slug, 1), queued(harness.project.slug, 2, {
        workflowState: "toReview", workflowLabel: "To Review", reviewPolicy: REVIEW_POLICY.AGENT,
        assignedRole: "reviewer", assignedLevel: "senior",
      })]);
      const options = { workspaceDir: harness.workspaceDir, projectSlug: harness.project.slug,
        provider: harness.provider, runCommand: harness.runCommand,
        workflow: { ...DEFAULT_WORKFLOW, roleExecution: EXECUTION_MODE.SEQUENTIAL } };
      const results = await Promise.all([projectTick({ ...options, targetRole: "developer" }), projectTick({ ...options, targetRole: "reviewer" })]);

      assert.equal(arrivals, 2, "both ticks passed their separate issue-lock prechecks");
      assert.equal(results.flatMap(result => result.pickups).length, 1);
      assert.equal(harness.commands.taskMessages().length, 1);
      assert.equal(harness.provider.callsTo("transitionLabel").length, 1);
      assert.ok(results.flatMap(result => result.skipped).some(skip => /Sequential/.test(skip.reason)));
    } finally { release(); await harness.cleanup(); }
  });

  it("honors zero pickup budget, disabled roles, and configured slot capacity", async () => {
    const harness = await createTestHarness({ workers: { developer: { level: "medior", active: true, issueId: 90 } } });

    try {
      await fs.writeFile(path.join(harness.workspaceDir, DATA_DIR, CONFIG_FIXTURE), "roles:\n  developer:\n    levels:\n      medior:\n        maxWorkers: 1\n");
      await seed(harness, [queued(harness.project.slug, 1)]);
      const options = { workspaceDir: harness.workspaceDir, projectSlug: harness.project.slug, provider: harness.provider, dryRun: true };
      const budget = await projectTick({ ...options, targetRole: "developer", maxPickups: 0 });

      assert.equal(budget.pickups.length, 0);
      assert.equal(budget.skipped[0]?.code, QUEUE_REASON.PICKUP_LIMIT);
      const capacity = await projectTick({ ...options, targetRole: "developer" });

      assert.equal(capacity.pickups.length, 0);
      assert.equal(capacity.skipped[0]?.code, QUEUE_REASON.CAPACITY);
      await fs.writeFile(path.join(harness.workspaceDir, DATA_DIR, CONFIG_FIXTURE), "roles:\n  developer:\n    enabled: false\n");
      const disabled = await projectTick({ ...options, targetRole: "developer" });

      assert.equal(disabled.skipped[0]?.code, QUEUE_REASON.ROLE_UNAVAILABLE);
    } finally { await harness.cleanup(); }
  });

  it("dispatches a configured custom role and level without built-in registry assumptions", async () => {
    const harness = await createTestHarness();

    try {
      await fs.writeFile(path.join(harness.workspaceDir, DATA_DIR, CONFIG_FIXTURE), `
roles:
  designer:
    levels:
      principal:
        rank: 1
        model: test/model
        maxWorkers: 1
    defaultLevel: principal
    completion:
      done: COMPLETE
workflow:
  states:
    designQueue:
      type: queue
      role: designer
      label: Design Queue
      color: "#112233"
      on:
        PICKUP:
          target: designing
    designing:
      type: active
      role: designer
      label: Designing
      color: "#223344"
      on:
        COMPLETE:
          target: todo
`);
      const record = queued(harness.project.slug, 1, { workflowState: "designQueue", workflowLabel: "Design Queue",
        assignedRole: "designer", assignedLevel: "principal", reviewPolicy: REVIEW_POLICY.HUMAN, testPolicy: TEST_POLICY.SKIP });

      await seed(harness, [record]);
      const config = await loadConfig(harness.workspaceDir, harness.project.slug);
      const roleConfig = config.roles.designer;

      assert.ok(roleConfig);
      const full = planQueuePickup({ issue: await harness.provider.getIssue(1), localState: record, role: "designer", roleConfig,
        worker: { levels: { principal: [{ ...emptySlot(), active: true, issueId: 90 }, emptySlot()] } } });

      assert.equal(full.kind, "blocked", "a leftover extra slot must not exceed configured capacity");
      const result = await projectTick({ workspaceDir: harness.workspaceDir, projectSlug: harness.project.slug,
        provider: harness.provider, runCommand: harness.runCommand, targetRole: "designer" });

      assert.equal(result.pickups[0]?.role, "designer");
      assert.equal(result.pickups[0]?.level, "principal");
      assert.equal(harness.commands.taskMessages().length, 1);
    } finally { await harness.cleanup(); }
  });
});
