/**
 * Tests for OpenClaw channel binding helpers.
 * Run with: npx tsx --test lib/application/setup/binding-manager.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { NOTIFICATION_CHANNEL } from "../../domain/index.js";
import { ensureChannelBinding, migrateChannelBinding } from "./binding-manager.js";

function createRuntime(initialConfig: OpenClawConfig): {
  runtime: PluginRuntime;
  writes: Array<{ nextConfig: OpenClawConfig; afterWrite?: unknown }>;
} {
  let currentConfig = structuredClone(initialConfig) as OpenClawConfig;
  const writes: Array<{ nextConfig: OpenClawConfig; afterWrite?: unknown }> = [];

  return {
    runtime: ({
      config: {
        current: () => currentConfig,
        replaceConfigFile: async (write: { nextConfig: OpenClawConfig; afterWrite?: unknown }) => {
          currentConfig = structuredClone(write.nextConfig) as OpenClawConfig;
          writes.push(write);
        },
      },
    } as unknown) as PluginRuntime,
    writes,
  };
}

describe("channel binding helpers", () => {
  it("adds a channel-wide binding for an existing agent once", async () => {
    const { runtime, writes } = createRuntime({
      bindings: [],
    } as OpenClawConfig);

    await ensureChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "orchestrator");
    await ensureChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "orchestrator");

    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(writes[0]?.nextConfig.bindings, [
      { match: { channel: NOTIFICATION_CHANNEL.TELEGRAM }, agentId: "orchestrator" },
    ]);
  });

  it("adds account-scoped channel-wide bindings without touching default bindings", async () => {
    const { runtime, writes } = createRuntime({
      bindings: [
        { match: { channel: NOTIFICATION_CHANNEL.TELEGRAM }, agentId: "main" },
      ],
    } as OpenClawConfig);

    await ensureChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "dev-agent", "dev");

    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(writes[0]?.nextConfig.bindings, [
      { match: { channel: NOTIFICATION_CHANNEL.TELEGRAM }, agentId: "main" },
      { match: { channel: NOTIFICATION_CHANNEL.TELEGRAM, accountId: "dev" }, agentId: "dev-agent" },
    ]);
  });

  it("adds peer-scoped bindings before channel-wide fallbacks for the same account", async () => {
    const { runtime, writes } = createRuntime({
      bindings: [
        { match: { channel: NOTIFICATION_CHANNEL.TELEGRAM, accountId: "dev" }, agentId: "dev-agent" },
      ],
    } as OpenClawConfig);

    await ensureChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "test-agent3", "dev", "-1003911014709:topic:331");

    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(writes[0]?.nextConfig.bindings, [
      {
        match: {
          channel: NOTIFICATION_CHANNEL.TELEGRAM,
          accountId: "dev",
          peer: { kind: "group", id: "-1003911014709:topic:331" },
        },
        agentId: "test-agent3",
      },
      { match: { channel: NOTIFICATION_CHANNEL.TELEGRAM, accountId: "dev" }, agentId: "dev-agent" },
    ]);
  });

  it("does not duplicate an existing peer-scoped binding", async () => {
    const { runtime, writes } = createRuntime({
      bindings: [],
    } as OpenClawConfig);

    await ensureChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "test-agent3", "dev", "-1003911014709:topic:331");
    await ensureChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "test-agent3", "dev", "-1003911014709:topic:331");

    assert.strictEqual(writes.length, 1);
  });

  it("rejects binding an occupied topic to a different agent", async () => {
    const { runtime, writes } = createRuntime({
      bindings: [
        {
          match: {
            channel: NOTIFICATION_CHANNEL.TELEGRAM,
            accountId: "dev",
            peer: { kind: "group", id: "-1003911014709:topic:331" },
          },
          agentId: "test-agent3",
        },
      ],
    } as OpenClawConfig);

    await assert.rejects(
      ensureChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "test-agent4", "dev", "-1003911014709:topic:331"),
      /already bound to agent "test-agent3"/,
    );
    assert.strictEqual(writes.length, 0);
  });

  it("migrates a channel-wide binding without creating a duplicate", async () => {
    const { runtime, writes } = createRuntime({
      bindings: [
        { match: { channel: NOTIFICATION_CHANNEL.TELEGRAM }, agentId: "old-agent" },
      ],
    } as OpenClawConfig);

    await migrateChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "old-agent", "new-agent");

    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(writes[0]?.nextConfig.bindings, [
      { match: { channel: NOTIFICATION_CHANNEL.TELEGRAM }, agentId: "new-agent" },
    ]);
  });

  it("migrates only the selected account-scoped channel-wide binding", async () => {
    const { runtime, writes } = createRuntime({
      bindings: [
        { match: { channel: NOTIFICATION_CHANNEL.TELEGRAM, accountId: "default" }, agentId: "main" },
        { match: { channel: NOTIFICATION_CHANNEL.TELEGRAM, accountId: "dev" }, agentId: "old-agent" },
      ],
    } as OpenClawConfig);

    await migrateChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "old-agent", "new-agent", "dev");

    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(writes[0]?.nextConfig.bindings, [
      { match: { channel: NOTIFICATION_CHANNEL.TELEGRAM, accountId: "default" }, agentId: "main" },
      { match: { channel: NOTIFICATION_CHANNEL.TELEGRAM, accountId: "dev" }, agentId: "new-agent" },
    ]);
  });
});
