/** Tests local attachment survival and durable provider URL publication in the shared upload use case. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { listAttachments } from "../../../state/index.js";
import { createTestHarness } from "../../../testing/index.js";
import { processAttachmentMessage } from "./process.js";

it("persists a confirmed URL and keeps local metadata when a later upload fails", async t => {
  const harness = await createTestHarness();
  t.after(() => harness.cleanup());
  const issue = await harness.provider.createIssue({ title: "Attachments", body: "", labels: [], assignees: [] });
  const source = path.join(harness.workspaceDir, "source.txt");
  await fs.writeFile(source, "evidence");
  const upload = t.mock.method(harness.provider, "uploadAttachment", async () => "https://example.com/evidence");
  const input = {
    workspaceDir: harness.workspaceDir, projectSlug: harness.project.slug, issueId: issue.iid,
    provider: harness.provider, uploader: "tester", mediaAttachments: [{ localPath: source, mimeType: "text/plain" }]
  };
  const [saved] = await processAttachmentMessage(input);
  assert.equal(saved?.publicUrl, "https://example.com/evidence");
  assert.equal((await listAttachments(harness.workspaceDir, harness.project.slug, issue.iid))[0]?.publicUrl, saved?.publicUrl);
  upload.mock.mockImplementation(async () => { throw new Error("provider unavailable"); });
  const [local] = await processAttachmentMessage(input);
  assert.equal(local?.publicUrl, undefined);
  assert.equal((await listAttachments(harness.workspaceDir, harness.project.slug, issue.iid)).length, 2);
});
