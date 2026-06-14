/**
 * Tests for workflow.taskMode and sprint review policy config.
 *
 * Run: npx tsx --test lib/config/sprint-mode.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./loader.js";
import { validateConfig } from "./schema.js";
import { ReviewPolicy, TaskMode } from "../workflow/index.js";

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "devclaw-sprint-config-"));
}

async function writeWorkflow(dir: string, content: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "workflow.yaml"), content, "utf-8");
}

describe("workflow.taskMode config", () => {
  it("defaults missing taskMode to issue", async () => {
    const workspace = await makeWorkspace();

    const config = await loadConfig(workspace);

    assert.strictEqual(config.workflow.taskMode, TaskMode.ISSUE);
  });

  it("allows project-level override to enable sprint for one project only", async () => {
    const workspace = await makeWorkspace();
    await writeWorkflow(
      path.join(workspace, "devclaw", "projects", "sprint-project"),
      [
        "workflow:",
        "  taskMode: sprint",
        "  reviewPolicy: sprint",
      ].join("\n"),
    );

    const defaultProject = await loadConfig(workspace, "default-project");
    const sprintProject = await loadConfig(workspace, "sprint-project");

    assert.strictEqual(defaultProject.workflow.taskMode, TaskMode.ISSUE);
    assert.strictEqual(defaultProject.workflow.reviewPolicy, ReviewPolicy.HUMAN);
    assert.strictEqual(sprintProject.workflow.taskMode, TaskMode.SPRINT);
    assert.strictEqual(sprintProject.workflow.reviewPolicy, ReviewPolicy.SPRINT);
  });

  it("rejects invalid taskMode values during schema validation", () => {
    assert.throws(
      () => validateConfig({ workflow: { taskMode: "epic" } }),
      /Invalid option/,
    );
  });

  it("rejects reviewPolicy sprint unless taskMode is sprint", async () => {
    const workspace = await makeWorkspace();
    await writeWorkflow(
      path.join(workspace, "devclaw"),
      [
        "workflow:",
        "  reviewPolicy: sprint",
      ].join("\n"),
    );

    await assert.rejects(
      () => loadConfig(workspace),
      /reviewPolicy "sprint" requires taskMode "sprint"/,
    );
  });

  it("accepts reviewPolicy skip with sprint taskMode at config level", async () => {
    const workspace = await makeWorkspace();
    await writeWorkflow(
      path.join(workspace, "devclaw"),
      [
        "workflow:",
        "  taskMode: sprint",
        "  reviewPolicy: skip",
      ].join("\n"),
    );

    const config = await loadConfig(workspace);

    assert.strictEqual(config.workflow.taskMode, TaskMode.SPRINT);
    assert.strictEqual(config.workflow.reviewPolicy, ReviewPolicy.SKIP);
  });
});
