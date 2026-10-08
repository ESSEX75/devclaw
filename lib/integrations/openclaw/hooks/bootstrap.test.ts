/**
 * Tests exact saved bootstrap ownership, custom roles and instruction loading failures.
 * Run with: npx tsx --test lib/integrations/openclaw/hooks/bootstrap.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { loadRoleInstructions } from "../../../state/index.js";
import { createTestHarness } from "../../../testing/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { registerBootstrapHook } from "./bootstrap.js";
import { loadWorkerBootstrapInstructions, resolveWorkerBootstrapIdentity } from "../../../application/index.js";

describe("registered worker bootstrap", () => {
  for (const role of ["developer", "tester", "architect", "security_auditor", "security-auditor"]) {
    it(`replaces orchestrator instructions for the exact ${role} session on repeated turns`, async () => {
      const sessionKey = `agent:test-agent:subagent:my-project-${role}-expert-long-ada`;
      const h = await createTestHarness({ projectName: "my-project", workers: { [role]: { level: "expert-long", sessionKey } } });
      try {
        if (role.startsWith("security")) {
          await fs.writeFile(path.join(h.workspaceDir, "devclaw", "workflow.yaml"),
            `roles:\n  ${role}:\n    levels:\n      expert-long:\n        rank: 1\n        model: model/security\n    defaultLevel: expert-long\n    completion:\n      done: COMPLETE\n`);
        }
        await h.writePrompt(role, `Instructions for ${role}`, h.project.slug);
        for (let turn = 0; turn < 2; turn++) {
          const result = await h.simulateBootstrap(sessionKey.toUpperCase());
          assert.equal(result.agentsMdContent, `Instructions for ${role}`);
        }
        const wrongAgent = await h.simulateBootstrap(sessionKey.replace("test-agent", "other-agent"));
        assert.ok(wrongAgent.agentsMdContent.includes("Orchestrator instructions"));
        const unregistered = await h.simulateBootstrap(sessionKey.replace("-ada", "-grace"));
        assert.ok(unregistered.agentsMdContent.includes("Orchestrator instructions"));
      } finally {
        await h.cleanup();
      }
    });
  }

  it("strips a registered custom worker's orchestrator prompt when no role prompt exists", async () => {
    const role = "security_auditor";
    const sessionKey = `agent:test-agent:subagent:my-project-${role}-standard-0`;
    const h = await createTestHarness({ projectName: "my-project", workers: { [role]: { level: "standard", sessionKey } } });
    try {
      await fs.writeFile(path.join(h.workspaceDir, "devclaw", "workflow.yaml"),
        `roles:\n  ${role}:\n    levels:\n      standard:\n        rank: 1\n        model: model/security\n    defaultLevel: standard\n    completion:\n      done: COMPLETE\n`);
      assert.equal((await h.simulateBootstrap(sessionKey)).agentsMdStripped, true);
    } finally {
      await h.cleanup();
    }
  });

  it("clears orchestrator instructions before a registered worker's prompt read fails", async () => {
    const sessionKey = "agent:test-agent:subagent:my-project-developer-medior-ada";
    const h = await createTestHarness({ projectName: "my-project", workers: { developer: { level: "medior", sessionKey } } });
    try {
      const promptDirectory = path.join(h.workspaceDir, "devclaw", "projects", h.project.slug, "prompts", "developer.md");
      await fs.mkdir(promptDirectory, { recursive: true });
      const handlers: Parameters<OpenClawPluginApi["registerHook"]>[1][] = [];
      const bootstrapFiles = [{ name: "AGENTS.md", path: path.join(h.workspaceDir, "AGENTS.md"),
        content: "Orchestrator instructions", missing: false }];
      registerBootstrapHook({ registerHook(_events, handler) { handlers.push(handler); } }, {
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      }, { resolveWorkerBootstrapIdentity, loadWorkerBootstrapInstructions });
      await assert.rejects(async () => {
        for (const handler of handlers) {
          await handler({ type: "agent", action: "bootstrap", sessionKey, timestamp: new Date(), messages: [],
            context: { workspaceDir: h.workspaceDir, bootstrapFiles } });
        }
      }, /Cannot read role instructions/);
      assert.equal(bootstrapFiles[0].content, "");
      assert.equal(bootstrapFiles[0].missing, true);
    } finally {
      await h.cleanup();
    }
  });

  it("does not use inherited object keys as configured roles", async () => {
    const sessionKey = "agent:test-agent:subagent:my-project-toString-standard-0";
    const h = await createTestHarness({ projectName: "my-project" });
    try {
      await h.writeProjects({ projects: { [h.project.slug]: { ...h.project, workers: { ...h.project.workers,
        toString: { levels: { standard: [{ active: false, issueId: null, sessionKey, startTime: null }] } },
      } } } });
      await h.writePrompt("toString", "Unconfigured prompt", h.project.slug);
      assert.equal((await h.simulateBootstrap(sessionKey)).agentsMdStripped, true);
    } finally {
      await h.cleanup();
    }
  });
});

describe("loadRoleInstructions", () => {
  it("should load project-specific instructions from devclaw/projects/<project>/prompts/", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-test-"));
    const projectDir = path.join(tmpDir, "devclaw", "projects", "test-project", "prompts");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, "developer.md"), "# Developer Instructions\nDo the thing.");

    const result = await loadRoleInstructions(tmpDir, "test-project", "developer");
    assert.strictEqual(result, "# Developer Instructions\nDo the thing.");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("should fall back to default instructions from devclaw/prompts/", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-test-"));
    const promptsDir = path.join(tmpDir, "devclaw", "prompts");
    await fs.mkdir(promptsDir, { recursive: true });
    await fs.writeFile(path.join(promptsDir, "tester.md"), "# Tester Default\nReview carefully.");

    const result = await loadRoleInstructions(tmpDir, "nonexistent-project", "tester");
    assert.strictEqual(result, "# Tester Default\nReview carefully.");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("should fall back to package defaults when workspace instructions do not exist", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-test-"));

    const result = await loadRoleInstructions(tmpDir, "missing", "developer");
    assert.ok(result.includes("# DEVELOPER Worker Instructions"));

    await fs.rm(tmpDir, { recursive: true });
  });

  it("should prefer project-specific over default", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-test-"));
    const projectPromptsDir = path.join(tmpDir, "devclaw", "projects", "my-project", "prompts");
    const defaultPromptsDir = path.join(tmpDir, "devclaw", "prompts");
    await fs.mkdir(projectPromptsDir, { recursive: true });
    await fs.mkdir(defaultPromptsDir, { recursive: true });
    await fs.writeFile(path.join(projectPromptsDir, "developer.md"), "Project-specific instructions");
    await fs.writeFile(path.join(defaultPromptsDir, "developer.md"), "Default instructions");

    const result = await loadRoleInstructions(tmpDir, "my-project", "developer");
    assert.strictEqual(result, "Project-specific instructions");

    await fs.rm(tmpDir, { recursive: true });
  });

});
