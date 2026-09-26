/** Exercises attachment persistence under concurrent mutation, failed writes, and unsafe metadata. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { listAttachments, purgeIssueAttachments, saveAttachment, updateAttachmentPublicUrl } from "./index.js";
import { attachmentDirectory, attachmentIndexPath } from "./paths.js";

/** Minimal bytes used to distinguish surviving entries after a failed mutation. */
const file = { buffer: Buffer.from("evidence"), filename: "evidence.txt", mimeType: "text/plain", uploader: "tester" };

it("serializes URL updates with saves and never resurrects a purged attachment", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-url-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = await saveAttachment(root, "test-project", 42, file);
  await Promise.all([
    updateAttachmentPublicUrl(root, "test-project", 42, first.id, "https://example.com/evidence"),
    saveAttachment(root, "test-project", 42, file),
  ]);
  const entries = await listAttachments(root, "test-project", 42);
  assert.equal(entries.length, 2);
  assert.equal(entries.find(entry => entry.id === first.id)?.publicUrl, "https://example.com/evidence");
  await purgeIssueAttachments(root, "test-project", 42);
  await assert.rejects(updateAttachmentPublicUrl(root, "test-project", 42, first.id, "https://example.com/late"), /no longer exists/);
  assert.deepEqual(await listAttachments(root, "test-project", 42), []);
});

it("rolls back new bytes after index replacement fails and preserves the previous index", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-write-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await saveAttachment(root, "test-project", 42, file);
  const directory = attachmentDirectory(root, "test-project", 42);
  const index = attachmentIndexPath(directory);
  const before = await fs.readFile(index, "utf8");
  const files = await fs.readdir(directory);
  const rename = fs.rename;
  const failure = new Error("index replacement denied");
  const injected = t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
    if (String(args[1]) === index) throw failure;
    return rename(...args);
  });
  await assert.rejects(saveAttachment(root, "test-project", 42, file), error => error === failure);
  injected.mock.restore();
  assert.equal(await fs.readFile(index, "utf8"), before);
  assert.deepEqual(await fs.readdir(directory), files);
});

it("propagates inaccessible indexes and rejects traversal metadata before saving", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-read-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const saved = await saveAttachment(root, "test-project", 42, file);
  const index = attachmentIndexPath(attachmentDirectory(root, "test-project", 42));
  const read = fs.readFile;
  const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
  const injected = t.mock.method(fs, "readFile", (...args: Parameters<typeof fs.readFile>) => {
    if (String(args[0]) === index) throw denied;
    return read(...args);
  });
  await assert.rejects(listAttachments(root, "test-project", 42), error => error instanceof Error && error.cause === denied);
  await assert.rejects(saveAttachment(root, "test-project", 42, file));
  injected.mock.restore();
  await fs.writeFile(index, JSON.stringify({ attachments: [{ ...saved, localPath: "../escape" }] }));
  await assert.rejects(listAttachments(root, "test-project", 42));
  await assert.rejects(saveAttachment(root, "test-project", 42, file));
});

it("validates every purge entry before removing any files", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-purge-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const saved = await saveAttachment(root, "test-project", 42, file);
  const directory = attachmentDirectory(root, "test-project", 42);
  await fs.mkdir(path.join(directory, "nested"));
  await assert.rejects(purgeIssueAttachments(root, "test-project", 42), /Unsafe attachment file/);
  assert.equal(await fs.readFile(path.join(directory, saved.localPath), "utf8"), "evidence");
  assert.equal((await listAttachments(root, "test-project", 42)).length, 1);
});

it("retains the index after partial purge and permits cleanup to resume", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-retry-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await saveAttachment(root, "test-project", 42, file);
  await saveAttachment(root, "test-project", 42, file);
  const directory = attachmentDirectory(root, "test-project", 42);
  const index = attachmentIndexPath(directory);
  const unlink = fs.unlink;
  let removed = 0;
  const failure = t.mock.method(fs, "unlink", async (...args: Parameters<typeof fs.unlink>) => {
    if (path.dirname(String(args[0])) === directory && ++removed === 2) throw new Error("interrupted purge");
    return unlink(...args);
  });
  await assert.rejects(purgeIssueAttachments(root, "test-project", 42), /interrupted purge/);
  failure.mock.restore();
  assert.ok(await fs.stat(index));
  await purgeIssueAttachments(root, "test-project", 42);
  assert.deepEqual(await listAttachments(root, "test-project", 42), []);
});
