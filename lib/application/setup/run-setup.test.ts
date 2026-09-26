/** Verifies setup preview purity, preservation, explicit recovery, and route preflight. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { loadConfig } from "../../state/index.js";
import { createSetupRuntime } from "../../testing/index.js";
import { runRoutingDoctor } from "../doctor/index.js";
import { runSetup } from "./run-setup.js";

/** Temporary test workspaces cleaned after each case. */
const directories: string[] = [];
/** Allocate an isolated workspace with custom instructions and configuration. */
async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-setup-"));
  directories.push(root);
  await fs.mkdir(path.join(root, "devclaw"));
  await fs.writeFile(path.join(root, "AGENTS.md"), "custom instructions");
  await fs.writeFile(path.join(root, "devclaw", "workflow.yaml"), `# keep this comment
roles:
  developer:
    levels:
      senior:
        model: model/custom
  security_auditor:
    levels:
      expert:
        rank: 3
        model: model/security
    defaultLevel: expert
    completion:
      done: COMPLETE
      blocked: BLOCKED
`);
  return root;
}
afterEach(async () => {
  for (const root of directories.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("shared setup command", () => {
  for (const operation of [{}, { ejectDefaults: true }, { resetDefaults: true }, { refreshInstructions: true }]) {
    it(`previews ${JSON.stringify(operation)} without workspace, config, or command effects`, async () => {
      const root = await workspace();
      const before = await fs.readdir(root, { recursive: true });
      const fixture = createSetupRuntime();
      const result = await runSetup({ ...fixture, workspacePath: root, ...operation, dryRun: true });
      assert.equal(result.dryRun, true);
      assert.deepEqual(result.filesWritten, []);
      assert.deepEqual(fixture.writes, []);
      assert.deepEqual(fixture.commands, []);
      assert.deepEqual(await fs.readdir(root, { recursive: true }), before);
      assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), "custom instructions");
    });
  }
  it("preserves existing files and custom models during ordinary setup", async () => {
    const root = await workspace();
    const fixture = createSetupRuntime();
    const before = await fs.readFile(path.join(root, "devclaw", "workflow.yaml"), "utf8");
    await runSetup({ ...fixture, workspacePath: root });
    const repeated = await runSetup({ ...fixture, workspacePath: root });
    assert.deepEqual(repeated.filesWritten, []);
    assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), "custom instructions");
    assert.equal(await fs.readFile(path.join(root, "devclaw", "workflow.yaml"), "utf8"), before);
    assert.equal(repeated.models.security_auditor.expert, "model/security");
  });
  it("patches a configured custom level without replacing other models or YAML comments", async () => {
    const root = await workspace();
    await runSetup({ ...createSetupRuntime(), workspacePath: root, models: { security_auditor: { expert: "model/new" } } });
    const config = await loadConfig(root);
    assert.equal(config.roles.security_auditor.levels.expert.model, "model/new");
    assert.equal(config.roles.developer.levels.senior.model, "model/custom");
    assert.match(await fs.readFile(path.join(root, "devclaw", "workflow.yaml"), "utf8"), /keep this comment/);
    await fs.access(path.join(root, "devclaw", "workflow.yaml.bak"));
  });
  it("rejects unknown configured levels before preflight or writes", async () => {
    const root = await workspace();
    const fixture = createSetupRuntime();
    await assert.rejects(runSetup({ ...fixture, workspacePath: root, models: { security_auditor: { missing: "model/new" } } }), /Unknown configured/);
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(fixture.commands, []);
  });
  for (const dryRun of [true, false]) {
    it(`rejects conflicting routes before effects (dryRun=${dryRun})`, async () => {
      const root = await workspace();
      const fixture = createSetupRuntime({ agents: { list: [{ id: "dev", workspace: root }, { id: "other" }] }, channels: { telegram: { accounts: { dev: {} } } }, bindings: [{ agentId: "other", match: { channel: "telegram", accountId: "dev", peer: { kind: "group", id: "chat" } } }] });
      await assert.rejects(runSetup({ ...fixture, agentId: "dev", channelBinding: "telegram", channelAccountId: "dev", channelPeerId: "chat", dryRun }), /already bound/);
      assert.deepEqual(fixture.writes, []);
      assert.deepEqual(fixture.commands, []);
    });
  }
  it("refreshes instructions explicitly and preserves configuration", async () => {
    const root = await workspace();
    const fixture = createSetupRuntime();
    await runSetup({ ...fixture, workspacePath: root, refreshInstructions: true });
    assert.equal(await fs.readFile(path.join(root, "AGENTS.md.bak"), "utf8"), "custom instructions");
    assert.equal((await loadConfig(root)).roles.security_auditor.levels.expert.model, "model/security");
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(fixture.commands, []);
  });
  it("resets malformed configuration explicitly while preserving project data", async () => {
    const root = await workspace();
    await fs.writeFile(path.join(root, "devclaw", "workflow.yaml"), "[invalid");
    await fs.writeFile(path.join(root, "devclaw", "projects.json"), '{"projects":{}}');
    const fixture = createSetupRuntime();
    await runSetup({ ...fixture, workspacePath: root, resetDefaults: true });
    assert.equal(await fs.readFile(path.join(root, "devclaw", "workflow.yaml.bak"), "utf8"), "[invalid");
    assert.equal(await fs.readFile(path.join(root, "devclaw", "projects.json"), "utf8"), '{"projects":{}}');
    await loadConfig(root);
    assert.deepEqual(fixture.commands, []);
  });
  it("keeps doctor read-only even for an uninitialized workspace", async () => {
    const root = await workspace();
    const target = path.join(root, "missing");
    const fixture = createSetupRuntime();
    await assert.rejects(runRoutingDoctor(fixture.runtime, target), /Cannot read projects registry/);
    await fs.writeFile(path.join(root, "devclaw", "projects.json"), '{"projects":{}}');
    const before = await fs.readdir(root, { recursive: true });
    await runRoutingDoctor(fixture.runtime, root);
    assert.deepEqual(await fs.readdir(root, { recursive: true }), before);
    await assert.rejects(fs.access(target));
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(fixture.commands, []);
  });
});
