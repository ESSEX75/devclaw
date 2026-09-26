/** Tests the routing and agent-isolation doctor report. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { ISSUE_PROVIDER, NOTIFICATION_CHANNEL } from "../../domain/index.js";
import type { ProjectsData } from "../../state/index.js";
import { DATA_DIR, PROJECTS_DIRECTORY_NAME } from "../../state/index.js";
import { createSetupRuntime, createTestHarness, replaceIssueArchiveStoreForTesting } from "../../testing/index.js";
import { DEVCLAW_AGENT_TOOLS } from "../setup/index.js";
import { buildRoutingDoctorReport, inspectArchiveRetention } from "./report.js";
import { runRoutingDoctor } from "./routing.js";

/** Persisted project used to exercise exact bindings and owner tool access. */
const projects: ProjectsData = {
  projects: {
    devclaw: {
      slug: "devclaw",
      name: "DevClaw",
      agentId: "dev-agent",
      repo: "repo",
      baseBranch: "develop",
      deployBranch: "develop",
      provider: ISSUE_PROVIDER.GITHUB,
      channels: [{
        channel: NOTIFICATION_CHANNEL.TELEGRAM,
        accountId: "dev",
        channelId: "chat-1",
        name: "primary",
      }],
      workers: {},
    },
  },
};

describe("routing doctor", () => {
  it("checks every project owner and preserves explicit denials", () => {
    const first = projects.projects.devclaw!;
    const second = { ...first, slug: "second", agentId: "second-agent",
      channels: first.channels.map((channel) => ({ ...channel, channelId: "chat-2" })),
    };
    const registry = { projects: { devclaw: first, second } };
    const config = {
      agents: { list: [
        { id: first.agentId, tools: { alsoAllow: [...DEVCLAW_AGENT_TOOLS] } },
        { id: second.agentId, tools: { alsoAllow: [...DEVCLAW_AGENT_TOOLS], deny: [DEVCLAW_AGENT_TOOLS[0]] } },
        { id: "foreign", tools: { deny: [...DEVCLAW_AGENT_TOOLS] } },
      ] },
      channels: { telegram: { enabled: true, accounts: { dev: {} } } },
    };
    const fixture = createSetupRuntime({ ...config, bindings: [first, second].map((project) => ({
      agentId: project.agentId,
      match: { channel: NOTIFICATION_CHANNEL.TELEGRAM, accountId: "dev",
        peer: { kind: "group", id: project.channels[0]!.channelId } },
    })) });
    const snapshot = structuredClone(fixture.runtime.config.current());
    const report = buildRoutingDoctorReport(fixture.runtime.config.current(), registry);

    assert.equal(report.ok, false);
    assert.deepEqual(report.findings.map((finding) => finding.code), ["isolation.owner_tools_incomplete"]);
    assert.deepEqual(report.agents, [
      { agentId: first.agentId, devclawToolsAllowed: true },
      { agentId: second.agentId, devclawToolsAllowed: false },
      { agentId: "foreign", devclawToolsAllowed: false },
    ]);
    assert.deepEqual(fixture.runtime.config.current(), snapshot);
    const allowed = { ...snapshot, agents: { list: snapshot.agents!.list!.map((agent) =>
      agent.id === second.agentId ? { ...agent, tools: { alsoAllow: [...DEVCLAW_AGENT_TOOLS] } } : agent) } };

    assert.equal(buildRoutingDoctorReport(allowed, registry).ok, true);
  });

  it("reports retention ordering as information without promising cleanup", () => {
    const retention = { archiveRetention: "1d", attachmentsRetention: "30d",
      deletedProviderRetention: "1d", maxPerHeartbeat: 10 };
    const findings = inspectArchiveRetention("devclaw", retention);

    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.code, "archive.retention_order");
    assert.equal(findings[0]?.severity, "info");
    assert.match(findings[0]!.message, /verify attachment cleanup/);
    assert.deepEqual(inspectArchiveRetention("devclaw", { ...retention, archiveRetention: "30d" }), []);
    assert.deepEqual(inspectArchiveRetention("devclaw", { ...retention, archiveRetention: "31d" }), []);
  });

  it("retains healthy project counters and reports an unreadable project without writes", async () => {
    const harness = await createTestHarness();

    try {
      const broken = { ...harness.project, slug: "broken", name: "Broken",
        channels: harness.project.channels.map((channel) => ({ ...channel, channelId: "broken-chat" })),
      };

      await harness.writeProjects({ projects: { broken, [harness.project.slug]: harness.project } });
      await replaceIssueArchiveStoreForTesting(harness.workspaceDir, broken.slug, { projectSlug: broken.slug, issues: {} });
      const directory = path.join(harness.workspaceDir, DATA_DIR, PROJECTS_DIRECTORY_NAME, broken.slug);
      const files = await fs.readdir(directory);

      assert.equal(files.length, 1);
      const blockedPath = path.join(directory, files[0]!);

      await fs.writeFile(blockedPath, "invalid archive JSON");
      const before = await fs.readdir(harness.workspaceDir, { recursive: true });
      const fixture = createSetupRuntime({
        agents: { list: [{ id: harness.project.agentId, tools: { alsoAllow: [...DEVCLAW_AGENT_TOOLS] } }] },
        channels: { telegram: { enabled: true, accounts: { default: {} } } },
        bindings: [harness.channelId, "broken-chat"].map((id) => ({ agentId: harness.project.agentId, match: {
          channel: NOTIFICATION_CHANNEL.TELEGRAM, accountId: "default",
          peer: { kind: "group", id },
        } })),
      });
      const report = await runRoutingDoctor(fixture.runtime, harness.workspaceDir);

      assert.equal(report.ok, false);
      assert.ok(report.findings.some((finding) => finding.code === "archive.inspection_failed"
        && finding.severity === "error" && finding.message.includes(broken.slug)));
      assert.deepEqual(report.archives.map((archive) => archive.projectSlug), [harness.project.slug]);
      assert.equal(report.archives[0]?.active, 0);
      assert.deepEqual(await fs.readdir(harness.workspaceDir, { recursive: true }), before);
      assert.equal(await fs.readFile(blockedPath, "utf-8"), "invalid archive JSON");
      assert.deepEqual(fixture.writes, []);
      assert.deepEqual(fixture.commands, []);
    } finally {
      await harness.cleanup();
    }
  });

  it("reports a valid route and isolated foreign agent", () => {
    const report = buildRoutingDoctorReport({
      agents: { list: [
        { id: "dev-agent", tools: { alsoAllow: [...DEVCLAW_AGENT_TOOLS] } },
        { id: "main", tools: { deny: [...DEVCLAW_AGENT_TOOLS] } },
      ] },
      channels: { telegram: { enabled: true, accounts: { dev: {} } } },
      bindings: [{
        agentId: "dev-agent",
        match: { channel: "telegram", accountId: "dev", peer: { kind: "group", id: "chat-1" } },
      }],
    }, projects);

    assert.equal(report.ok, true);
    assert.deepEqual(report.findings.map((finding) => finding.code), ["routing.ok"]);
  });

  it("reports an invalid binding and exposed foreign agent", () => {
    const report = buildRoutingDoctorReport({
      agents: { list: [
        { id: "dev-agent", tools: { alsoAllow: [...DEVCLAW_AGENT_TOOLS] } },
        { id: "main", tools: { alsoAllow: ["task_start"] } },
      ] },
      channels: { telegram: { enabled: true, accounts: { dev: {} } } },
      bindings: [{
        agentId: "main",
        match: { channel: "telegram", accountId: "dev", peer: { kind: "group", id: "chat-1" } },
      }],
    }, projects);

    assert.equal(report.ok, false);
    assert.ok(report.findings.some((finding) => finding.code === "route.binding_agent_mismatch"));
    assert.ok(report.findings.some((finding) => finding.code === "isolation.foreign_agent_tools_visible"));
  });
});
