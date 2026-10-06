/** Verifies explicit model onboarding and read-only effective configuration guidance. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";

import { getOnboardingContext } from "./onboarding.js";

it("offers explicit assignments and default acceptance without model discovery", async () => {
  const result = await getOnboardingContext(undefined, undefined, "first-run");

  assert.match(result.instructions, /omit `models`/);
  assert.match(result.instructions, /explicit model ID/);
  assert.doesNotMatch(result.instructions, /autoconfigure_models|BLOCK setup/);
});

it("shows effective custom assignments without changing workspace files", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-onboarding-"));

  try {
    const configDir = path.join(workspaceDir, "devclaw");
    const workflowPath = path.join(configDir, "workflow.yaml");
    const yaml = `roles:
  developer:
    levels:
      senior:
        model: model/workspace-override
  tester: false
  security_auditor:
    levels:
      expert:
        rank: 1
        model: model/custom-security
    defaultLevel: expert
    completion:
      done: COMPLETE
`;

    await fs.mkdir(configDir);
    await fs.writeFile(workflowPath, yaml, "utf8");
    const before = await fs.readdir(workspaceDir, { recursive: true });
    const result = await getOnboardingContext(workspaceDir, {}, "reconfigure");

    assert.match(result.instructions, /developer senior\*\*: model\/workspace-override/);
    assert.match(result.instructions, /security_auditor expert\*\*: model\/custom-security/);
    assert.doesNotMatch(result.instructions, /\*\*tester /);
    assert.equal(await fs.readFile(workflowPath, "utf8"), yaml);
    assert.deepEqual(await fs.readdir(workspaceDir, { recursive: true }), before);
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

it("rejects reconfiguration guidance without a target workspace", async () => {
  await assert.rejects(getOnboardingContext(undefined, {}, "reconfigure"), /requires a workspace/);
});
