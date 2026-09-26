/** Verifies that media routing never crosses account, thread, owner, or workspace boundaries. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { updateProjects } from "../../../state/index.js";
import { createTestHarness } from "../../../testing/index.js";
import { resolveAttachmentProject } from "./routing.js";

it("requires every route component and rejects multiple matching workspaces", async t => {
  const a = await createTestHarness();
  const b = await createTestHarness();
  t.after(async () => { await a.cleanup(); await b.cleanup(); });
  const endpoint = a.project.channels[0]!;
  const route = { channel: endpoint.channel, accountId: endpoint.accountId, conversationId: endpoint.channelId, agentId: a.project.agentId };
  const workspaces = [{ workspaceDir: a.workspaceDir, agentId: a.project.agentId }];
  assert.equal((await resolveAttachmentProject(workspaces, route))?.project.slug, a.project.slug);
  for (const mismatch of [{ accountId: "other" }, { channel: "other" }, { conversationId: "other" }, { agentId: "other" }, { threadId: "99" }, { accountId: "" }, { agentId: "" }]) {
    assert.equal(await resolveAttachmentProject(workspaces, { ...route, ...mismatch }), null);
  }
  await updateProjects(b.workspaceDir, data => ({ data: { ...data, projects: { [a.project.slug]: a.project } }, result: undefined }));
  await assert.rejects(resolveAttachmentProject([...workspaces, { workspaceDir: b.workspaceDir, agentId: a.project.agentId }], route), /ambiguous/);
  await updateProjects(a.workspaceDir, data => ({
    data: {
      ...data, projects: {
        ...data.projects,
        [a.project.slug]: { ...a.project, channels: [{ ...endpoint, threadId: "99" }] },
      }
    }, result: undefined
  }));
  assert.equal(await resolveAttachmentProject(workspaces, route), null);
  assert.equal((await resolveAttachmentProject(workspaces, { ...route, threadId: "99" }))?.workspaceDir, a.workspaceDir);
});
