/** Verifies layered configuration loading and resolution for custom workflows and roles. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { getLabelColors, getStateLabels } from "../../domain/index.js";
import { getConfiguredRoleIds, getResolvedRole, isConfiguredRoleId, loadConfig } from "./index.js";

/** Temporary workspaces removed after each configuration loader test. */
const temporaryWorkspaces: string[] = [];

/**
 * Create an isolated workspace containing one workflow configuration document.
 *
 * @param workflowYaml - Complete YAML content written as the workspace configuration layer.
 */
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
    levels:
      standard:
        rank: 1
        model: model/security
    defaultLevel: standard
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
roles:
  designer:
    levels:
      standard:
        rank: 1
        model: model/designer
    defaultLevel: standard
    completion:
      done: COMPLETE
workflow:
  states:
    designQueue:
      type: queue
      role: designer
      label: Design Queue
      color: "#112233"
      on:
        PICKUP:
          target: designing
    designing:
      type: active
      role: designer
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
    assert.equal(state?.role, "designer");
    assert.equal(state?.color, "#223344");
    assert.equal(state?.label, "Product Designing");
    assert.equal(state?.on?.COMPLETE?.target, "toReview");
  });

  it("rejects a non-canonical project slug before resolving a project config path", async () => {
    const workspaceDir = await createWorkspace("{}");

    await assert.rejects(loadConfig(workspaceDir, "../outside"), /lowercase kebab-case/);
  });

});

describe("custom role resolution", () => {
  it("inherits built-in level fields when overriding only its model", async () => {
    const workspaceDir = await createWorkspace(`
roles:
  developer:
    levels:
      senior:
        model: model/custom-senior
`);

    const role = getResolvedRole(await loadConfig(workspaceDir), "developer");

    assert.equal(role?.levels.senior?.rank, 3);
    assert.equal(role?.levels.senior?.model, "model/custom-senior");
    assert.equal(role?.levels.senior?.maxWorkers, 2);
    assert.ok(role?.levels.junior);
    assert.ok(role?.levels.medior);
  });

  it("resolves a complete custom role without adding it to the built-in registry", async () => {
    const workspaceDir = await createWorkspace(`
roles:
  security_auditor:
    levels:
      junior:
        rank: 1
        model: anthropic/claude-sonnet-4-5
        emoji: "🔐"
      senior:
        rank: 2
        model: anthropic/claude-opus-4-6
        maxWorkers: 1
    defaultLevel: junior
    completion:
      done: COMPLETE
      blocked: BLOCKED
`);

    const config = await loadConfig(workspaceDir);
    const role = getResolvedRole(config, "security_auditor");

    assert.ok(role);
    assert.deepEqual(Object.keys(role.levels), ["junior", "senior"]);
    assert.equal(role.defaultLevel, "junior");
    assert.equal(role.levels.senior?.model, "anthropic/claude-opus-4-6");
    assert.equal(role.levels.senior?.maxWorkers, 1);
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
    levels:
      junior: { rank: 1, model: model/junior }
      senior: { rank: 2, model: model/senior }
    defaultLevel: junior
    completion:
      done: COMPLETE
`);
    const projectDir = path.join(workspaceDir, "devclaw", "projects", "secure-app");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, "workflow.yaml"), `
roles:
  security_auditor:
    levels:
      senior:
        model: model/project-senior
        maxWorkers: 3
    completion:
      blocked: BLOCKED
`, "utf8");

    const config = await loadConfig(workspaceDir, "secure-app");
    const role = getResolvedRole(config, "security_auditor");

    assert.equal(role?.levels.junior?.model, "model/junior");
    assert.equal(role?.levels.senior?.model, "model/project-senior");
    assert.equal(role?.levels.senior?.maxWorkers, 3);
    assert.equal(role?.completion.done, "COMPLETE");
    assert.equal(role?.completion.blocked, "BLOCKED");
  });

  it("rejects incomplete custom roles with exact paths", async () => {
    const workspaceDir = await createWorkspace(`
roles:
  security_auditor:
    levels:
      junior: {}
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
    levels:
      junior: false
      medior: false
      senior: false
      apprentice:
        rank: 1
        model: model/apprentice
        emoji: "A"
      principal:
        rank: 2
        model: model/principal
        maxWorkers: 4
        emoji: "P"
    defaultLevel: apprentice
`);

    const config = await loadConfig(workspaceDir);
    const role = getResolvedRole(config, "developer");

    assert.deepEqual(Object.keys(role?.levels ?? {}), ["apprentice", "principal"]);
    assert.equal(role?.defaultLevel, "apprentice");
    assert.equal(role?.levels.apprentice?.model, "model/apprentice");
    assert.equal(role?.levels.principal?.model, "model/principal");
    assert.equal(role?.levels.junior, undefined);
    assert.equal(role?.levels.principal?.maxWorkers, 4);
    assert.equal(role?.levels.principal?.emoji, "P");
  });
});
