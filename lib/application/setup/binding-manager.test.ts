/**
 * Tests for OpenClaw channel binding helpers.
 * Run with: npx tsx --test lib/application/setup/binding-manager.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { NOTIFICATION_CHANNEL } from "../../domain/index.js";
import { ensureChannelBinding } from "./binding-manager.js";

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
  it("adds an exact binding for an existing agent once", async () => {
    const { runtime, writes } = createRuntime({
      agents: { list: [{ id: "orchestrator" }] },
      channels: { telegram: { enabled: true, accounts: { default: {} } } },
      bindings: [],
    } as OpenClawConfig);

    await ensureChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "orchestrator", "default", "chat-1");
    await ensureChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "orchestrator", "default", "chat-1");

    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(writes[0]?.nextConfig.bindings, [
      {
        match: {
          channel: NOTIFICATION_CHANNEL.TELEGRAM,
          accountId: "default",
          peer: { kind: "group", id: "chat-1" },
        },
        agentId: "orchestrator",
      },
    ]);
  });

  it("adds an account-scoped exact binding without touching another account", async () => {
    const { runtime, writes } = createRuntime({
      agents: { list: [{ id: "dev-agent" }] },
      channels: { telegram: { enabled: true, accounts: { dev: {} } } },
      bindings: [
        { match: { channel: NOTIFICATION_CHANNEL.TELEGRAM }, agentId: "main" },
      ],
    } as OpenClawConfig);

    await ensureChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "dev-agent", "dev", "chat-1");

    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(writes[0]?.nextConfig.bindings, [
      { match: { channel: NOTIFICATION_CHANNEL.TELEGRAM }, agentId: "main" },
      {
        match: {
          channel: NOTIFICATION_CHANNEL.TELEGRAM,
          accountId: "dev",
          peer: { kind: "group", id: "chat-1" },
        },
        agentId: "dev-agent",
      },
    ]);
  });

  it("adds peer-scoped bindings before channel-wide fallbacks for the same account", async () => {
    const { runtime, writes } = createRuntime({
      agents: { list: [{ id: "dev-agent" }, { id: "test-agent3" }] },
      channels: { telegram: { enabled: true, accounts: { dev: {} } } },
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
      agents: { list: [{ id: "test-agent3" }] },
      channels: { telegram: { enabled: true, accounts: { dev: {} } } },
      bindings: [],
    } as OpenClawConfig);

    await ensureChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "test-agent3", "dev", "-1003911014709:topic:331");
    await ensureChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "test-agent3", "dev", "-1003911014709:topic:331");

    assert.strictEqual(writes.length, 1);
  });

  it("rejects binding an occupied topic to a different agent", async () => {
    const { runtime, writes } = createRuntime({
      agents: { list: [{ id: "test-agent3" }, { id: "test-agent4" }] },
      channels: { telegram: { enabled: true, accounts: { dev: {} } } },
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

});
