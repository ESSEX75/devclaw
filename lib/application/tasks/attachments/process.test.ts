/** Tests local attachment survival and durable provider URL publication in the shared upload use case. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { createProvider } from "../../../integrations/providers/index.js";
import { getAttachmentPath, listAttachments } from "../../../state/index.js";
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

for (const remoteResponse of ["lost", "unconfirmed"]) {
  it(`keeps locally saved bytes without a public URL after a real GitLab ${remoteResponse} upload`, async t => {
    const harness = await createTestHarness();
    t.after(() => harness.cleanup());
    const issue = await harness.provider.createIssue({ title: "Evidence", body: "", labels: [], assignees: [] });
    const source = path.join(harness.workspaceDir, "evidence.txt");
    await fs.writeFile(source, "durable evidence");
    let uploads = 0;
    const { provider } = await createProvider({ provider: "gitlab", repoPath: harness.workspaceDir, runCommand: async argv => {
      let stdout = "{}";
      if (argv[0] === "curl") {
        uploads++;
        if (remoteResponse === "lost") throw new Error("lost response after submission");
      } else if (argv[1] === "issue") {
        stdout = JSON.stringify({ iid: issue.iid, title: "Evidence", description: "", labels: [], state: "opened", web_url: "https://git.test/team/repo/issues/1" });
      } else if (argv[1] === "config") stdout = "test-token";
      else if (argv[2] === "projects/:id") stdout = '{"id":7,"web_url":"https://git.test/team/repo","path_with_namespace":"team/repo"}';
      else stdout = '{"id":1}';
      return { stdout, stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
    } });
    const [saved] = await processAttachmentMessage({
      workspaceDir: harness.workspaceDir, projectSlug: harness.project.slug, issueId: issue.iid,
      provider, uploader: "tester", mediaAttachments: [{ localPath: source, mimeType: "text/plain" }],
    });
    assert.ok(saved);
    assert.equal(uploads, 1);
    assert.equal(saved.publicUrl, undefined);
    const persisted = await listAttachments(harness.workspaceDir, harness.project.slug, issue.iid);
    assert.deepEqual(persisted, [saved]);
    const localPath = await getAttachmentPath(harness.workspaceDir, harness.project.slug, issue.iid, saved.localPath);
    assert.equal(await fs.readFile(localPath, "utf8"), "durable evidence");
  });
}
