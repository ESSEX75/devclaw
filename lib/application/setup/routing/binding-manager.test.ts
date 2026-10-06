/**
 * Tests for OpenClaw channel binding helpers.
 * Run with: npx tsx --test lib/application/setup/routing/binding-manager.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { createSetupRuntime as createRuntime } from "../../../testing/index.js";
import { NOTIFICATION_CHANNEL } from "../../../domain/index.js";
import { ensureChannelBinding } from "./binding-manager.js";

describe("channel binding helpers", () => {
  it("adds an exact binding for an existing agent once", async () => {
    const { runtime, writes } = createRuntime({
      agents: { list: [{ id: "orchestrator" }] },
      channels: { telegram: { enabled: true, accounts: { default: {} } } },
      bindings: [],
    });

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
    });

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
    });

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
    });

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
    });

    await assert.rejects(
      ensureChannelBinding(runtime, NOTIFICATION_CHANNEL.TELEGRAM, "test-agent4", "dev", "-1003911014709:topic:331"),
      /already bound to agent "test-agent3"/,
    );
    assert.strictEqual(writes.length, 0);
  });

});

it("keeps a direct binding distinct from a group binding with the same peer id", async () => {
  const { runtime } = createRuntime({ agents: { list: [{ id: "owner" }, { id: "direct-owner" }] }, channels: { telegram: { accounts: { dev: {} } } },
    bindings: [{ agentId: "direct-owner", match: { channel: "telegram", accountId: "dev", peer: { kind: "direct", id: "peer" } } }] });
  await ensureChannelBinding(runtime, "telegram", "owner", "dev", "peer");
  await ensureChannelBinding(runtime, "telegram", "owner", "dev", "peer");
  assert.equal(runtime.config.current().bindings?.length, 2);
  assert.equal(runtime.config.current().bindings?.[0]?.agentId, "direct-owner");
});

it("creates an exact Telegram direct binding without accepting a group peer with the same ID", async () => {
  const { runtime, writes } = createRuntime({
    agents: { list: [{ id: "owner" }] },
    channels: { telegram: { accounts: { dev: {} } } },
    bindings: [{ agentId: "owner", match: { channel: "telegram", accountId: "dev", peer: { kind: "group", id: "931077226" } } }],
  });

  await ensureChannelBinding(runtime, "telegram", "owner", "dev", "931077226");
  await ensureChannelBinding(runtime, "telegram", "owner", "dev", "931077226");
  assert.equal(writes.length, 1);
  assert.deepEqual(runtime.config.current().bindings?.map(binding => binding.match.peer?.kind), ["group", "direct"]);
});
