/**
 * Tests for OpenClaw config writes performed by DevClaw setup.
 * Run with: npx tsx --test lib/application/setup/plugin-config.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { DEVCLAW_AGENT_TOOLS, writePluginConfig } from "./plugin-config.js";

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
        ],
      },
      plugins: {
        allow: ["devclaw"],
        entries: {
          devclaw: { config: {} },
        },
      },
    } as OpenClawConfig);

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
  });
});
