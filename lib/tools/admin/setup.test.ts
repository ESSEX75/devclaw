/** Exercises CLI and tool adapters against the same setup operation semantics. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Command } from "commander";
import { registerSetupCommand } from "../../cli/commands/setup-command.js";
import { createSetupRuntime } from "../../testing/index.js";
import { createSetupTool } from "./setup.js";

describe("setup adapter parity", () => {
  for (const [flag, param] of [["--eject-defaults", "ejectDefaults"], ["--reset-defaults", "resetDefaults"], ["--refresh-instructions", "refreshInstructions"]]) {
    for (const dryRun of [true, false]) {
      it(`${flag} agrees for tool and CLI (dryRun=${dryRun})`, async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-setup-adapters-"));
        try {
          const toolDir = path.join(root, "tool");
          const cliDir = path.join(root, "cli");
          for (const target of [toolDir, cliDir]) {
            await fs.mkdir(target);
            await fs.writeFile(path.join(target, "AGENTS.md"), "custom instructions");
          }
          const fixture = createSetupRuntime();
          const tool = createSetupTool(fixture)({ config: {}, workspaceDir: toolDir });
          assert.ok(tool && !Array.isArray(tool));
          await tool.execute("test", { [param]: true, dryRun });
          const command = new Command();
          registerSetupCommand(command, fixture);
          await command.parseAsync(["setup", "--workspace", cliDir, flag, ...(dryRun ? ["--dry-run"] : [])], { from: "user" });
          const files = await fs.readdir(toolDir, { recursive: true });
          assert.deepEqual(files, await fs.readdir(cliDir, { recursive: true }));
          for (const file of files) {
            if (!(await fs.stat(path.join(toolDir, file))).isFile()) continue;
            assert.deepEqual(await fs.readFile(path.join(toolDir, file)), await fs.readFile(path.join(cliDir, file)));
          }
          assert.deepEqual(fixture.writes, []);
          assert.deepEqual(fixture.commands, []);
          if (dryRun) assert.deepEqual(files, ["AGENTS.md"]);
        } finally { await fs.rm(root, { recursive: true, force: true }); }
      });
    }
  }
});
