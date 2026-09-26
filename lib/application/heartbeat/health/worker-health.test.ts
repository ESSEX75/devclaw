/** Exercises diagnosis purity, exact worker ownership, and safe remediation failures. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getProject, getRoleWorker, loadConfig, readIssueStateStore, readProjects, updateSlot } from "../../../state/index.js";
import { createTestHarness, type TestHarness } from "../../../testing/index.js";
import { writeIssueRuntimeState } from "../../issue-runtime/index.js";
import { performHealthPass } from "../passes.js";
import type { WorkerHealthInput } from "./types.js";
import { diagnoseWorkerHealth } from "./worker-diagnosis.js";
import { remediateWorkerHealth } from "./worker-remediation.js";
import { checkWorkerHealth } from "./worker-slot-health.js";

/** Capture every workspace file to detect diagnostic audit or persistence writes.
 * @param directory - Isolated workspace to snapshot.
 */
async function snapshot(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await fs.readdir(directory, { recursive: true })).sort()) {
    const file = path.join(directory, name);
    if ((await fs.stat(file)).isFile()) result[name] = (await fs.readFile(file)).toString("base64");
  }
  return result;
}

describe("worker diagnosis and remediation", () => {
  let harness: TestHarness;
  let input: WorkerHealthInput;
  beforeEach(async () => {
    const startedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    harness = await createTestHarness({ workers: { developer: { active: true, issueId: 42, level: "medior", sessionKey: "worker", startTime: startedAt, previousLabel: "To Do" } } });
    const issue = harness.provider.seedIssue({ iid: 42, labels: ["Doing"] });
    await writeIssueRuntimeState({
      workspaceDir: harness.workspaceDir, project: harness.project, issue,
      providerType: harness.project.provider, workflow: harness.workflow,
      workflowState: "doing", workflowLabel: "Doing",
      activeWorker: { role: "developer", level: "medior", slotIndex: 0, sessionKey: "worker", startedAt },
    });
    input = { workspaceDir: harness.workspaceDir, projectSlug: harness.project.slug, project: harness.project, role: "developer", provider: harness.provider, workflow: harness.workflow, sessions: new Map(), runCommand: harness.runCommand };
  });
  afterEach(async () => { await harness.cleanup(); });

  it("dry-run context overflow makes no filesystem, provider, or session writes", async () => {
    input.sessions?.set("worker", { key: "worker", updatedAt: Date.now(), percentUsed: 100, abortedLastRun: true });
    const before = await snapshot(harness.workspaceDir);
    const findings = await checkWorkerHealth({ ...input, autoFix: false });
    assert.equal(findings[0]?.issue.type, "context_overflow");
    assert.equal(findings[0]?.plannedAction, "requeue");
    assert.deepEqual(await snapshot(harness.workspaceDir), before);
    assert.equal(harness.provider.callsTo("transitionLabel").length, 0);
    assert.equal(harness.commands.commands.length, 0);
  });

  it("rejects a stale finding after the same issue receives a replacement session", async () => {
    const finding = (await diagnoseWorkerHealth(input))[0];
    assert.ok(finding);
    await updateSlot(input.workspaceDir, input.projectSlug, input.role, "medior", 0, (slot) => ({ ...slot, sessionKey: "replacement" }));
    const result = await remediateWorkerHealth(input, finding);
    assert.equal(result.fixed, false);
    assert.equal(harness.provider.callsTo("transitionLabel").length, 0);
    const project = getProject(await readProjects(input.workspaceDir), input.projectSlug);
    assert.ok(project);
    assert.equal(getRoleWorker(project, "developer").levels.medior?.[0]?.sessionKey, "replacement");
  });

  it("keeps the complete diagnostic health pass read-only, including provider-only issues", async () => {
    harness.provider.seedIssue({ iid: 43, labels: ["developer:medior"] });
    const resolvedConfig = await loadConfig(input.workspaceDir, input.projectSlug);
    const before = await snapshot(harness.workspaceDir);
    const findings = await performHealthPass({ ...input, resolvedConfig, autoFix: false });
    assert.ok(findings.some((fix) => fix.issue.type === "stateless_issue" && fix.issue.issueId === 43));
    assert.deepEqual(await snapshot(harness.workspaceDir), before);
    assert.equal(harness.commands.commands.length, 0);
    assert.equal(harness.provider.callsTo("transitionLabel").length, 0);
  });

  it("plans and applies stale-worker recovery while retaining the configured previous queue", async () => {
    input.sessions?.set("worker", { key: "worker", updatedAt: Date.now(), percentUsed: 1 });
    input.staleWorkerHours = 0.1;
    const findings = await diagnoseWorkerHealth(input);
    assert.equal(findings[0]?.issue.type, "stale_worker");
    const results = await checkWorkerHealth({ ...input, autoFix: true });
    assert.equal(results[0]?.fixed, true);
    assert.equal((await readIssueStateStore(input.workspaceDir, input.projectSlug)).issues["42"]?.workflowLabel, "To Do");
  });

  it("keeps ownership when requeue fails and reports the error", async () => {
    harness.provider.transitionLabel = async () => { throw new Error("provider write failed"); };
    const results = await checkWorkerHealth({ ...input, autoFix: true });
    assert.equal(results[0]?.fixed, false);
    assert.match(results[0]?.error ?? "", /provider write failed/);
    const project = getProject(await readProjects(input.workspaceDir), input.projectSlug);
    assert.ok(project);
    assert.equal(getRoleWorker(project, "developer").levels.medior?.[0]?.active, true);
    assert.equal((await readIssueStateStore(input.workspaceDir, input.projectSlug)).issues["42"]?.workflowLabel, "Doing");
  });

  it("does not treat an unavailable provider as evidence that the issue is gone", async () => {
    harness.provider.getIssue = async () => { throw new Error("unauthorized"); };
    const before = await snapshot(harness.workspaceDir);
    await assert.rejects(checkWorkerHealth({ ...input, autoFix: true }), /unauthorized/);
    assert.deepEqual(await snapshot(harness.workspaceDir), before);
  });

  it("requeues a dead worker once and makes a repeated tick a no-op", async () => {
    assert.equal((await checkWorkerHealth({ ...input, autoFix: true }))[0]?.fixed, true);
    const project = getProject(await readProjects(input.workspaceDir), input.projectSlug);
    assert.ok(project);
    const calls = harness.provider.callsTo("transitionLabel").length;
    assert.deepEqual(await checkWorkerHealth({ ...input, project, autoFix: true }), []);
    assert.equal(harness.provider.callsTo("transitionLabel").length, calls);
  });

  it("repairs provider label drift without releasing a locally active worker", async () => {
    input.sessions?.set("worker", { key: "worker", updatedAt: Date.now(), percentUsed: 1 });
    harness.provider.seedIssue({ iid: 42, labels: ["To Do"] });
    const results = await checkWorkerHealth({ ...input, autoFix: true });
    assert.equal(results[0]?.plannedAction, "reconcile_projection");
    assert.equal(results[0]?.fixed, true);
    const project = getProject(await readProjects(input.workspaceDir), input.projectSlug);
    assert.ok(project);
    assert.equal(getRoleWorker(project, "developer").levels.medior?.[0]?.active, true);
    assert.ok((await harness.provider.getIssue(42)).labels.includes("Doing"));
  });
});
