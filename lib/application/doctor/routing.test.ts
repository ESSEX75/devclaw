/** Tests the routing and agent-isolation doctor report. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NOTIFICATION_CHANNEL, type ProjectsData } from "../../domain/index.js";
import { DEVCLAW_AGENT_TOOLS } from "../setup/plugin-config.js";
import { buildRoutingDoctorReport } from "./routing.js";

const projects: ProjectsData = {
  projects: {
    devclaw: {
      slug: "devclaw",
      name: "DevClaw",
      agentId: "dev-agent",
      repo: "repo",
      groupName: "DevClaw",
      deployUrl: "",
      baseBranch: "develop",
      deployBranch: "develop",
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
