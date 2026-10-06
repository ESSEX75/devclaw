/** Checks that ambiguous and incomplete SDK routes cannot upload files to a provider. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { readProjects } from "../../state/index.js";
import { createTestHarness } from "../../testing/index.js";
import { GitHubProvider } from "../providers/github.js";
import { registerAttachmentHook } from "./attachment-hook.js";
import type { AttachmentHookRegistrar } from "./types.js";

it("performs no provider upload for incomplete or ambiguous routing", async t => {
  const harness = await createTestHarness();
  t.after(() => harness.cleanup());
  const endpoint = harness.project.channels[0]!;
  const registry = await readProjects(harness.workspaceDir);
  // Deliberately corrupt the registry to model externally written conflicting destinations.
  await fs.writeFile(path.join(harness.workspaceDir, "devclaw", "projects.json"), JSON.stringify({
    ...registry, projects: { ...registry.projects, duplicate: { ...harness.project, slug: "duplicate" } },
  }));
  const handlers: Array<Parameters<AttachmentHookRegistrar["on"]>[1]> = [];
  const warnings: string[] = [];
  registerAttachmentHook({
    /** Capture the SDK callback for controlled message delivery.
     * @param _name - Registered received-message hook.
     * @param handler - Callback under test.
     */
    on(_name, handler) { handlers.push(handler); },
  }, { runCommand: harness.runCommand,
    logger: { warn: message => { warnings.push(message); } },
    runtime: { config: { current: () => ({ agents: { list: [{ id: harness.project.agentId, workspace: harness.workspaceDir }] } }) } },
  });
  const upload = t.mock.method(GitHubProvider.prototype, "uploadAttachment", async () => "https://example.com/unexpected");
  const handler = handlers[0];
  assert.ok(handler);
  const event = { content: "Evidence for #42", from: "tester", media: [{ path: path.join(harness.workspaceDir, "never-read.txt"), contentType: "text/plain" }] };
  const context = { channelId: endpoint.channel, accountId: endpoint.accountId,
    conversationId: endpoint.channelId, sessionKey: `agent:${harness.project.agentId}:test` };
  await handler(event, { ...context, accountId: undefined });
  await handler(event, { ...context, sessionKey: undefined });
  assert.equal(warnings.length, 0);
  await handler(event, context);
  assert.equal(upload.mock.callCount(), 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /destination is already registered/);
  await assert.rejects(fs.stat(path.join(harness.workspaceDir, "devclaw", "attachments")), { code: "ENOENT" });
});
