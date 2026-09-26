/** Provides an in-memory SDK config mutation transport for setup and adapter tests. */
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import type { SetupRuntime } from "../application/setup/index.js";
import type { RunCommand } from "../context.js";

/** Create isolated config state and record committed mutations and external commands.
 * @param initialConfig - Configuration snapshot to clone for the test.
 */
export function createSetupRuntime(initialConfig: OpenClawConfig = {}) {
  let config = structuredClone(initialConfig);
  const writes: Array<{ nextConfig: OpenClawConfig; afterWrite?: unknown }> = [];
  const commands: string[][] = [];
  const runtime: SetupRuntime = {
    config: {
      current: () => config,
      mutateConfigFile: async ({ mutate, afterWrite }) => {
        const draft = structuredClone(config);

        await mutate(draft, {
          snapshot: {
            path: "test", exists: true, raw: "", parsed: config, sourceConfig: config,
            resolved: config, runtimeConfig: config, valid: true, config, issues: [], warnings: [], legacyIssues: [],
          },
          previousHash: null,
        });
        if (JSON.stringify(draft) !== JSON.stringify(config)) {
          config = draft;
          writes.push({ nextConfig: draft, afterWrite });
        }
      },
    },
  };
  const runCommand: RunCommand = async (args) => {
    commands.push([...args]);

    return { code: 0, stdout: JSON.stringify({ status: "approved", approved: ["operator.read", "operator.write"] }), stderr: "", signal: null, killed: false, termination: "exit" };
  };

  return { runtime, runCommand, writes, commands };
}
