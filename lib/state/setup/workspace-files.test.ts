/**
 * workspace.test.ts — Tests for write-once default file behavior.
 *
 * Verifies that initialization creates missing files without hidden overwrites.
 *
 * Run: npx tsx --test lib/state/setup/workspace-files.test.ts
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileExists, initializeWorkspaceFiles, refreshSystemInstructionFiles } from "./workspace-files.js";
import { DATA_DIR, PROJECTS_DIRECTORY_NAME, WORKFLOW_FILE_NAME } from "../paths.js";
import {
  AGENTS_FILE_NAME,
  IDENTITY_FILE_NAME,
  LOG_DIRECTORY_NAME,
  PROMPTS_DIRECTORY_NAME,
  ROLE_PROMPT_FILE_EXTENSION,
} from "./const.js";

/** Prefix used for isolated setup filesystem test workspaces. */
const TEST_WORKSPACE_PREFIX = "devclaw-ws-test-";

/** Built-in role used to verify role prompt persistence. */
const TEST_ROLE_ID = "developer";

/** Project directory used to verify project-specific prompt preservation. */
const TEST_PROJECT_DIRECTORY_NAME = "my-app";

/** Current isolated workspace removed after each setup test. */
let tmpDir: string;

/** Create and initialize the common directories for one isolated setup test. */
async function makeTmpDir(): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), TEST_WORKSPACE_PREFIX));
  // Create the log dir so audit logging doesn't fail
  await fs.mkdir(path.join(tmpDir, DATA_DIR, LOG_DIRECTORY_NAME), { recursive: true });
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("initializeWorkspaceFiles — write-once behavior", () => {
  it("should create workflow.yaml when missing", async () => {
    const ws = await makeTmpDir();
    await initializeWorkspaceFiles(ws);
    const workflowPath = path.join(ws, DATA_DIR, WORKFLOW_FILE_NAME);
    assert.ok(await fileExists(workflowPath), "workflow.yaml should be created");
  });

  it("should NOT overwrite existing workflow.yaml", async () => {
    const ws = await makeTmpDir();
    const workflowPath = path.join(ws, DATA_DIR, WORKFLOW_FILE_NAME);
    await fs.mkdir(path.dirname(workflowPath), { recursive: true });
    const customContent = "# My custom workflow\nroles:\n  developer:\n    levels:\n      junior:\n        model: openai/gpt-4\n";
    await fs.writeFile(workflowPath, customContent, "utf-8");

    await initializeWorkspaceFiles(ws);

    const afterContent = await fs.readFile(workflowPath, "utf-8");
    assert.strictEqual(afterContent, customContent, "workflow.yaml should not be overwritten");
  });

  it("keeps concurrent initialization create-only for every managed file", async () => {
    const ws = await makeTmpDir();
    const results = await Promise.all([
      initializeWorkspaceFiles(ws),
      initializeWorkspaceFiles(ws),
      initializeWorkspaceFiles(ws),
    ]);
    const written = results.flatMap((result) => result.written);

    assert.equal(new Set(written).size, written.length);
    assert.ok(written.includes(path.join(DATA_DIR, WORKFLOW_FILE_NAME)));
  });

  it("should create prompt files when missing", async () => {
    const ws = await makeTmpDir();
    await initializeWorkspaceFiles(ws);
    const devPrompt = path.join(ws, DATA_DIR, PROMPTS_DIRECTORY_NAME, `${TEST_ROLE_ID}${ROLE_PROMPT_FILE_EXTENSION}`);
    assert.ok(await fileExists(devPrompt), "developer.md prompt should be created");
  });

  it("should NOT overwrite existing prompt files", async () => {
    const ws = await makeTmpDir();
    const devPrompt = path.join(ws, DATA_DIR, PROMPTS_DIRECTORY_NAME, `${TEST_ROLE_ID}${ROLE_PROMPT_FILE_EXTENSION}`);
    await fs.mkdir(path.dirname(devPrompt), { recursive: true });
    const customPrompt = "# My custom developer instructions\nAlways use TypeScript.";
    await fs.writeFile(devPrompt, customPrompt, "utf-8");

    await initializeWorkspaceFiles(ws);

    const afterContent = await fs.readFile(devPrompt, "utf-8");
    assert.strictEqual(afterContent, customPrompt, "developer.md should not be overwritten");
  });

  it("should NOT delete project-specific prompts", async () => {
    const ws = await makeTmpDir();
    const projectPrompt = path.join(
      ws,
      DATA_DIR,
      PROJECTS_DIRECTORY_NAME,
      TEST_PROJECT_DIRECTORY_NAME,
      PROMPTS_DIRECTORY_NAME,
      `${TEST_ROLE_ID}${ROLE_PROMPT_FILE_EXTENSION}`,
    );
    await fs.mkdir(path.dirname(projectPrompt), { recursive: true });
    const customPrompt = "# My App Developer\nUse React.";
    await fs.writeFile(projectPrompt, customPrompt, "utf-8");

    await initializeWorkspaceFiles(ws);

    assert.ok(await fileExists(projectPrompt), "project-specific prompt should still exist");
    const afterContent = await fs.readFile(projectPrompt, "utf-8");
    assert.strictEqual(afterContent, customPrompt, "project-specific prompt should be untouched");
  });

  it("should create IDENTITY.md when missing but not overwrite", async () => {
    const ws = await makeTmpDir();

    // First run: creates it
    await initializeWorkspaceFiles(ws);
    const identityPath = path.join(ws, IDENTITY_FILE_NAME);
    assert.ok(await fileExists(identityPath), "IDENTITY.md should be created");

    // Customize it
    const customIdentity = "# My Identity\nI am a lobster.";
    await fs.writeFile(identityPath, customIdentity, "utf-8");

    // Second run: should NOT overwrite
    await initializeWorkspaceFiles(ws);
    const afterContent = await fs.readFile(identityPath, "utf-8");
    assert.strictEqual(afterContent, customIdentity, "IDENTITY.md should not be overwritten");
  });

  it("does not overwrite system instructions during initialization", async () => {
    const ws = await makeTmpDir();
    const agentsPath = path.join(ws, AGENTS_FILE_NAME);
    await fs.writeFile(agentsPath, "# Old agents content", "utf-8");

    await initializeWorkspaceFiles(ws);

    const afterContent = await fs.readFile(agentsPath, "utf-8");
    assert.strictEqual(afterContent, "# Old agents content");
  });

  it("refreshes system instructions only through the explicit capability", async () => {
    const ws = await makeTmpDir();
    const agentsPath = path.join(ws, AGENTS_FILE_NAME);
    await fs.writeFile(agentsPath, "# Old agents content", "utf-8");

    const result = await refreshSystemInstructionFiles(ws);

    assert.notStrictEqual(await fs.readFile(agentsPath, "utf-8"), "# Old agents content");
    assert.ok(result.written.includes(AGENTS_FILE_NAME));
  });
});
