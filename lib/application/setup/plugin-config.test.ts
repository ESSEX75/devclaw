/**
 * Tests for OpenClaw config writes performed by DevClaw setup.
 * Run with: npx tsx --test lib/application/setup/plugin-config.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSetupRuntime as createRuntime } from "../../testing/index.js";
import { resolveProjectToolOwners } from "./tool-ownership.js";
import { DEVCLAW_AGENT_TOOLS } from "./const.js";
import { readProjects } from "../../state/index.js";
import { DOCTOR_FINDING_CODE } from "../doctor/const.js";
import { runRoutingDoctor } from "../doctor/index.js";
import { writePluginConfig } from "./plugin-config.js";


describe("writePluginConfig", () => {
  it("grants DevClaw tools to the configured agent and preserves session denials", async () => {
    const { runtime, writes } = createRuntime({
      agents: {
        list: [
          {
            id: "orchestrator",
            workspace: "/tmp/orchestrator",
            tools: { alsoAllow: ["existing_tool"] },
          },
          {
            id: "main",
            workspace: "/tmp/main",
            tools: { alsoAllow: ["existing_tool", "task_start"] },
          },
        ],
      },
      plugins: {
        allow: ["devclaw"],
        entries: {
          devclaw: { config: {} },
        },
      },
    });

    await writePluginConfig(runtime, "orchestrator");

    assert.strictEqual(writes.length, 1);
    const agent = writes[0]?.nextConfig.agents?.list?.find((entry) => entry.id === "orchestrator");
    assert.ok(agent?.tools);
    assert.ok(agent.tools.alsoAllow?.includes("existing_tool"));
    for (const tool of DEVCLAW_AGENT_TOOLS) {
      assert.ok(agent.tools.alsoAllow?.includes(tool), `expected ${tool} to be allowed`);
    }
    assert.ok(agent.tools.deny?.includes("sessions_spawn"));
    assert.ok(agent.tools.deny?.includes("sessions_send"));
    assert.strictEqual(agent.tools.allow, undefined);
    const foreignAgent = writes[0]?.nextConfig.agents?.list?.find((entry) => entry.id === "main");

    assert.ok(foreignAgent?.tools?.alsoAllow?.includes("existing_tool"));
    assert.ok(!foreignAgent?.tools?.alsoAllow?.includes("task_start"));
    for (const tool of DEVCLAW_AGENT_TOOLS) {
      assert.ok(foreignAgent?.tools?.deny?.includes(tool), `expected ${tool} to be denied for main`);
    }
  });
});

/** Exercise policy against real validated registries in separate workspaces. */
it("preserves both project owners through A -> B -> A while denying a foreign agent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-owners-"));
  try {
    for (const id of ["a", "b"]) {
      await fs.mkdir(path.join(root, id, "devclaw"), { recursive: true });
      await fs.writeFile(path.join(root, id, "devclaw", "projects.json"), JSON.stringify({ projects: {
        [id]: { slug: id, name: id, agentId: id, repo: "repo", baseBranch: "main", deployBranch: "main", provider: "github", workers: {},
          channels: [{ channel: "telegram", accountId: "dev", channelId: id, name: "primary" }] },
      } }));
    }
    const { runtime } = createRuntime({ agents: { defaults: { workspace: root }, list: [
      { id: "a" },
      { id: "b", workspace: path.join(root, "b") },
      { id: "foreign", workspace: path.join(root, "foreign"), tools: { alsoAllow: ["existing_tool", "task_start"] } },
    ] } });
    for (const selected of ["a", "b", "a"]) {
      await writePluginConfig(runtime, selected);
      for (const agent of runtime.config.current().agents?.list ?? []) {
        for (const tool of DEVCLAW_AGENT_TOOLS) {
          assert.equal(agent.tools?.alsoAllow?.includes(tool) ?? false, agent.id !== "foreign");
          assert.equal(agent.tools?.deny?.includes(tool) ?? false, agent.id === "foreign");
        }
      }
    }
    const report = await runRoutingDoctor(runtime, path.join(root, "a"));
    assert.equal(report.findings.some(finding => finding.code === DOCTOR_FINDING_CODE.FOREIGN_AGENT_TOOLS_VISIBLE), false);
    assert.ok(report.agents.filter(agent => agent.agentId !== "foreign").every(agent => agent.devclawToolsAllowed));
    const foreign = runtime.config.current().agents?.list?.find(agent => agent.id === "foreign");
    assert.ok(foreign?.tools?.alsoAllow?.includes("existing_tool"));
    const current = runtime.config.current();
    const sharedConfig = { agents: { ...current.agents, list: current.agents?.list?.map(agent =>
      agent.id === "b" ? { ...agent, workspace: path.join(root, "a") } : agent) } };
    const registryA = await readProjects(path.join(root, "a"));
    const registryB = await readProjects(path.join(root, "b"));
    await fs.writeFile(path.join(root, "a", "devclaw", "projects.json"), JSON.stringify({ projects: {
      ...registryA.projects, ...registryB.projects,
      foreign: { ...registryA.projects.a, slug: "foreign", agentId: "foreign", channels: [{ channel: "telegram", accountId: "dev", channelId: "foreign", name: "primary" }] },
    } }));
    assert.deepStrictEqual([...await resolveProjectToolOwners(sharedConfig)].sort(), ["a", "b"]);
    await fs.writeFile(path.join(root, "b", "devclaw", "projects.json"), "broken");
    const before = structuredClone(runtime.config.current());
    await assert.rejects(writePluginConfig(runtime, "a"), /Cannot read projects registry/);
    assert.deepStrictEqual(runtime.config.current(), before);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("extends an explicit allow policy without producing the SDK allow/alsoAllow conflict", async () => {
  const { runtime } = createRuntime({ agents: { list: [{ id: "owner", workspace: "/tmp/devclaw-policy-owner", tools: { allow: ["read"], deny: ["task_start", "other_denial"] } }] } });
  await writePluginConfig(runtime, "owner");
  const policy = runtime.config.current().agents?.list?.[0]?.tools;
  assert.equal(policy?.alsoAllow, undefined);
  assert.ok(policy?.allow?.includes("read"));
  for (const tool of DEVCLAW_AGENT_TOOLS) assert.ok(policy?.allow?.includes(tool));
  assert.ok(policy?.deny?.includes("other_denial"));
  assert.ok(!policy?.deny?.includes("task_start"));
});
