/** Tests project routing ambiguity and persisted provider selection. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { ISSUE_PROVIDER, NOTIFICATION_CHANNEL } from "../../domain/index.js";
import { DATA_DIR } from "../../state/index.js";
import { createTestHarness } from "../../testing/index.js";
import { findProjectByRoute, resolveProject, resolveProjectByRoute, resolveProvider } from "./index.js";

describe("project context", () => {
  it("requires exactly one route for a channel-only project lookup", async () => {
    const harness = await createTestHarness();

    try {
      await assert.rejects(resolveProject(harness.workspaceDir, "missing"), /No project found/);
      const sole = await resolveProject(harness.workspaceDir, harness.channelId);

      assert.equal(sole.project.slug, harness.project.slug);
      assert.equal(sole.endpoint.name, "primary");
      const registry = await harness.readProjects();
      const endpoints = [
        { ...sole.endpoint, name: "other-account", accountId: "second" },
        { ...sole.endpoint, name: "other-channel", channel: NOTIFICATION_CHANNEL.SLACK },
        { ...sole.endpoint, name: "thread", threadId: "topic-7" },
      ];

      registry.projects[harness.project.slug].channels.push(...endpoints);
      await harness.writeProjects(registry);
      await assert.rejects(resolveProject(harness.workspaceDir, harness.channelId), /ambiguous/);

      for (const endpoint of [sole.endpoint, ...endpoints]) {
        const route = { channel: endpoint.channel, accountId: endpoint.accountId,
          channelId: endpoint.channelId, threadId: endpoint.threadId };
        const exact = await resolveProjectByRoute(harness.workspaceDir, route);

        assert.equal(exact.endpoint.name, endpoint.name);
        assert.equal(findProjectByRoute(exact.data, route, harness.project.agentId)?.project.slug, harness.project.slug);
        assert.equal(findProjectByRoute(exact.data, route, "foreign-agent"), null);
      }
    } finally { await harness.cleanup(); }
  });

  it("does not select the first project when identical channel IDs have different accounts", async () => {
    const harness = await createTestHarness();

    try {
      const registry = await harness.readProjects();
      const other = { ...structuredClone(harness.project), slug: "other-project", name: "other-project",
        channels: [{ ...harness.project.channels[0], name: "other-account", accountId: "other" }] };

      registry.projects[other.slug] = other;
      await harness.writeProjects(registry);
      await assert.rejects(resolveProject(harness.workspaceDir, harness.channelId), /ambiguous/);
      const exact = await resolveProjectByRoute(harness.workspaceDir, { channel: other.channels[0].channel,
        accountId: "other", channelId: harness.channelId });

      assert.equal(exact.project.slug, other.slug);
      await assert.rejects(resolveProjectByRoute(harness.workspaceDir, { channel: NOTIFICATION_CHANNEL.TELEGRAM,
        accountId: "missing", channelId: harness.channelId }), /does not resolve/);
    } finally { await harness.cleanup(); }
  });

  it("uses the persisted provider ID and validated workflow configuration", async () => {
    const harness = await createTestHarness();

    try {
      const github = await resolveProvider(harness.workspaceDir, harness.project, harness.runCommand);

      assert.equal(github.type, ISSUE_PROVIDER.GITHUB);
      const gitlab = await resolveProvider(harness.workspaceDir,
        { ...harness.project, provider: ISSUE_PROVIDER.GITLAB }, harness.runCommand);

      assert.equal(gitlab.type, ISSUE_PROVIDER.GITLAB);
      await fs.writeFile(path.join(harness.workspaceDir, DATA_DIR, "workflow.yaml"), "workflow: [invalid");
      await assert.rejects(resolveProvider(harness.workspaceDir, harness.project, harness.runCommand));
    } finally { await harness.cleanup(); }
  });
});
