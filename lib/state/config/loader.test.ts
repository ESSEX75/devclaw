import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { getConfiguredRoleIds, getResolvedRole, isConfiguredRoleId, loadConfig } from "./index.js";

const temporaryWorkspaces: string[] = [];

async function createWorkspace(workflowYaml: string): Promise<string> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-custom-role-"));
  const configDir = path.join(workspaceDir, "devclaw");

  temporaryWorkspaces.push(workspaceDir);
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "workflow.yaml"), workflowYaml, "utf8");

  return workspaceDir;
}

afterEach(async () => {
  await Promise.all(temporaryWorkspaces.splice(0).map(
    (workspaceDir) => fs.rm(workspaceDir, { recursive: true, force: true }),
  ));
});

describe("custom role resolution", () => {
  it("resolves a complete custom role without adding it to the built-in registry", async () => {
    const workspaceDir = await createWorkspace(`
roles:
  security_auditor:
    levels: [junior, senior]
    defaultLevel: junior
    models:
      junior: anthropic/claude-sonnet-4-5
      senior:
        model: anthropic/claude-opus-4-6
        maxWorkers: 1
    emoji:
      junior: "🔐"
    completion:
      done: COMPLETE
      blocked: BLOCKED
`);

    const config = await loadConfig(workspaceDir);
    const role = getResolvedRole(config, "security_auditor");

    assert.ok(role);
    assert.deepEqual(role.levels, ["junior", "senior"]);
    assert.equal(role.defaultLevel, "junior");
    assert.equal(role.models.senior, "anthropic/claude-opus-4-6");
    assert.equal(role.levelMaxWorkers.senior, 1);
    assert.equal(role.completion.done, "COMPLETE");
    assert.equal(isConfiguredRoleId(config, "security_auditor"), true);
    assert.ok(getConfiguredRoleIds(config).includes("security_auditor"));
  });

  it("keeps disabled built-in roles visible but excludes them from runtime iteration", async () => {
    const workspaceDir = await createWorkspace(`
roles:
  tester: false
`);

    const config = await loadConfig(workspaceDir);

    assert.equal(getResolvedRole(config, "tester")?.enabled, false);
    assert.equal(getConfiguredRoleIds(config).includes("tester"), false);
    assert.equal(getConfiguredRoleIds(config, true).includes("tester"), true);
  });

  it("merges project overrides over a workspace custom role", async () => {
    const workspaceDir = await createWorkspace(`
roles:
  security_auditor:
    levels: [junior, senior]
    defaultLevel: junior
    models:
      junior: model/junior
      senior: model/senior
    completion:
      done: COMPLETE
`);
    const projectDir = path.join(workspaceDir, "devclaw", "projects", "secure-app");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, "workflow.yaml"), `
roles:
  security_auditor:
    models:
      senior:
        model: model/project-senior
        maxWorkers: 3
    completion:
      blocked: BLOCKED
`, "utf8");

    const config = await loadConfig(workspaceDir, "secure-app");
    const role = getResolvedRole(config, "security_auditor");

    assert.equal(role?.models.junior, "model/junior");
    assert.equal(role?.models.senior, "model/project-senior");
    assert.equal(role?.levelMaxWorkers.senior, 3);
    assert.equal(role?.completion.done, "COMPLETE");
    assert.equal(role?.completion.blocked, "BLOCKED");
  });

  it("rejects incomplete custom roles with exact paths", async () => {
    const workspaceDir = await createWorkspace(`
roles:
  security_auditor:
    levels: [junior]
`);

    await assert.rejects(
      loadConfig(workspaceDir),
      /roles\.security_auditor\.defaultLevel/,
    );
  });
});
