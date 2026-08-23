import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { getLabelColors, getStateLabels } from "../../domain/index.js";
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

describe("custom workflow state resolution", () => {
  it("does not add transitions to terminal states during merge", async () => {
    const workspaceDir = await createWorkspace(`
workflow:
  states:
    done:
      type: terminal
      label: Done
      color: "#5cb85c"
    rejected:
      type: terminal
      label: Rejected
      color: "#e11d48"
`);

    const config = await loadConfig(workspaceDir);

    assert.equal(Object.hasOwn(config.workflow.states.done ?? {}, "on"), false);
    assert.equal(Object.hasOwn(config.workflow.states.rejected ?? {}, "on"), false);
  });

  it("merges custom states and sparse built-in overrides into the complete workflow", async () => {
    const workspaceDir = await createWorkspace(`
roles:
  security_auditor:
    levels: [standard]
    defaultLevel: standard
    models:
      standard: model/security
    completion:
      done: COMPLETE
      blocked: BLOCKED
workflow:
  initial: securityQueue
  states:
    securityQueue:
      type: queue
      role: security_auditor
      label: Security Queue
      color: "#123456"
      on:
        PICKUP:
          target: securityActive
    securityActive:
      type: active
      role: security_auditor
      label: Security Active
      color: "#654321"
      on:
        COMPLETE:
          target: todo
        BLOCKED:
          target: refining
    todo:
      label: Ready for Development
      color: "#abcdef"
`);

    const config = await loadConfig(workspaceDir);
    const labels = getStateLabels(config.workflow);
    const colors = getLabelColors(config.workflow);

    assert.equal(config.workflow.initial, "securityQueue");
    assert.equal(config.workflow.states.securityQueue?.role, "security_auditor");
    assert.equal(config.workflow.states.securityActive?.on?.COMPLETE?.target, "todo");
    assert.equal(config.workflow.states.todo?.type, "queue");
    assert.equal(config.workflow.states.todo?.role, "developer");
    assert.equal(config.workflow.states.todo?.label, "Ready for Development");
    assert.ok(labels.includes("Security Queue"));
    assert.ok(labels.includes("Security Active"));
    assert.ok(labels.includes("Done"));
    assert.equal(colors.get("Ready for Development"), "#abcdef");
  });

  it("deep-merges project state overrides over workspace custom states", async () => {
    const workspaceDir = await createWorkspace(`
workflow:
  states:
    designQueue:
      type: queue
      role: developer
      label: Design Queue
      color: "#112233"
      on:
        PICKUP:
          target: designing
    designing:
      type: active
      role: developer
      label: Designing
      color: "#223344"
      on:
        COMPLETE:
          target: todo
`);
    const projectDir = path.join(workspaceDir, "devclaw", "projects", "design-app");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, "workflow.yaml"), `
workflow:
  states:
    designing:
      label: Product Designing
      on:
        COMPLETE:
          target: toReview
`, "utf8");

    const config = await loadConfig(workspaceDir, "design-app");
    const state = config.workflow.states.designing;

    assert.equal(state?.type, "active");
    assert.equal(state?.role, "developer");
    assert.equal(state?.color, "#223344");
    assert.equal(state?.label, "Product Designing");
    assert.equal(state?.on?.COMPLETE?.target, "toReview");
  });

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

  it("resolves custom levels without filtering them through the built-in registry", async () => {
    const workspaceDir = await createWorkspace(`
roles:
  developer:
    levels: [apprentice, principal]
    defaultLevel: apprentice
    models:
      apprentice: model/apprentice
      principal:
        model: model/principal
        maxWorkers: 4
    emoji:
      apprentice: "A"
      principal: "P"
`);

    const config = await loadConfig(workspaceDir);
    const role = getResolvedRole(config, "developer");

    assert.deepEqual(role?.levels, ["apprentice", "principal"]);
    assert.equal(role?.defaultLevel, "apprentice");
    assert.equal(role?.models.apprentice, "model/apprentice");
    assert.equal(role?.models.principal, "model/principal");
    assert.equal(role?.levelMaxWorkers.principal, 4);
    assert.equal(role?.emoji.principal, "P");
  });
});
