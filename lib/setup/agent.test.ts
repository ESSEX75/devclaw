/**
 * Tests for agent config creation.
 * Run with: npx tsx --test lib/setup/agent.test.ts
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createAgent } from "./agent.js";

let tmpDir: string | undefined;

async function makeOpenClawHome(): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-agent-test-"));
  return path.join(tmpDir, ".openclaw");
}

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

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

describe("createAgent", () => {
  it("updates OpenClaw config directly without an external agent CLI", async () => {
    const name = `DevClaw Test ${Date.now()}`;
    const expectedAgentId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const openClawHome = await makeOpenClawHome();

    const { runtime, writes } = createRuntime({
      agents: {
        defaults: { model: "openai/gpt-5.4" },
        list: [],
      },
    } as OpenClawConfig);

    const result = await createAgent(runtime, name, { openClawHome });

    assert.strictEqual(result.agentId, expectedAgentId);
    assert.strictEqual(writes.length, 1, "createAgent should perform one config write");
    assert.deepStrictEqual(writes[0]?.afterWrite, {
      mode: "none",
      reason: "DevClaw setup continues with a second config write that owns reload handling.",
    });

    const agent = writes[0]?.nextConfig.agents?.list?.find((entry) => entry.id === expectedAgentId);
    assert.ok(agent, "new agent should be written to agents.list");
    assert.strictEqual(agent.name, name);
    assert.strictEqual(agent.model, "openai/gpt-5.4");
    assert.strictEqual(agent.workspace, result.workspacePath);

    assert.strictEqual(writes[0]?.nextConfig.bindings, undefined);

    await fs.access(result.workspacePath);
    await fs.access(path.join(openClawHome, "agents", expectedAgentId, "agent"));
    await fs.access(path.join(openClawHome, "agents", expectedAgentId, "sessions"));
  });
});
