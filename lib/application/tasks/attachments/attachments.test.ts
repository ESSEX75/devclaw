/** Exercises media normalization, attachment persistence, and operator/worker rendering. */
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { extractMediaAttachments } from "../../../integrations/openclaw/media/index.js";
import { getAttachmentPath, listAttachments, purgeIssueAttachments, saveAttachment } from "../../../state/index.js";
import { extractIssueReferences, formatAttachmentComment, formatAttachmentsForTask } from "./index.js";

describe("extractMediaAttachments", () => {
  it("extracts single MediaPath", () => {
    const result = extractMediaAttachments({
      MediaPath: "/tmp/media/photo.jpg",
      MediaType: "image/jpeg",
    });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].localPath, "/tmp/media/photo.jpg");
    assert.strictEqual(result[0].mimeType, "image/jpeg");
    assert.strictEqual(result[0].filename, "photo.jpg");
  });

  it("extracts multiple MediaPaths", () => {
    const result = extractMediaAttachments({
      MediaPaths: ["/tmp/a.png", "/tmp/b.pdf"],
      MediaTypes: ["image/png", "application/pdf"],
    });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].localPath, "/tmp/a.png");
    assert.strictEqual(result[0].mimeType, "image/png");
    assert.strictEqual(result[1].localPath, "/tmp/b.pdf");
    assert.strictEqual(result[1].mimeType, "application/pdf");
  });

  it("handles MediaPath + MediaPaths combined", () => {
    const result = extractMediaAttachments({
      MediaPath: "/tmp/single.jpg",
      MediaType: "image/jpeg",
      MediaPaths: ["/tmp/multi1.png", "/tmp/multi2.pdf"],
      MediaTypes: ["image/png", "application/pdf"],
    });
    assert.strictEqual(result.length, 3);
  });

  it("returns empty for no media", () => {
    const result = extractMediaAttachments({});
    assert.strictEqual(result.length, 0);
  });

  it("handles missing mime types gracefully", () => {
    const result = extractMediaAttachments({
      MediaPath: "/tmp/file.bin",
    });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].mimeType, undefined);
    assert.strictEqual(result[0].filename, "file.bin");
  });

  it("skips empty/invalid paths", () => {
    const result = extractMediaAttachments({
      MediaPaths: ["", null, "/tmp/valid.jpg"],
    });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].localPath, "/tmp/valid.jpg");
  });
});

describe("extractIssueReferences", () => {
  it("extracts single reference", () => {
    assert.deepStrictEqual(extractIssueReferences("Fix this #42"), [42]);
  });

  it("extracts multiple references", () => {
    const refs = extractIssueReferences("See #42 and #13 and #42");
    assert.deepStrictEqual(refs, [42, 13]); // deduplicated
  });

  it("returns empty for no references", () => {
    assert.deepStrictEqual(extractIssueReferences("no issues here"), []);
  });

  it("ignores very large issue numbers", () => {
    assert.deepStrictEqual(extractIssueReferences("#999999"), []);
  });
});

describe("saveAttachment / listAttachments", () => {
  it("saves and lists attachments", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-attach-test-"));
    try {
      const buffer = Buffer.from("hello world");
      const meta = await saveAttachment(tmpDir, "test-project", 42, {
        buffer,
        filename: "test.txt",
        mimeType: "text/plain",
        uploader: "user123",
      });

      assert.ok(meta.id);
      assert.strictEqual(meta.issueId, 42);
      assert.strictEqual(meta.filename, "test.txt");
      assert.strictEqual(meta.mimeType, "text/plain");
      assert.strictEqual(meta.size, 11);
      assert.strictEqual(meta.uploader, "user123");

      // Verify file exists on disk
      const fullPath = await getAttachmentPath(tmpDir, "test-project", 42, meta.localPath);
      const content = await fs.readFile(fullPath, "utf-8");
      assert.strictEqual(content, "hello world");

      // List should return the saved attachment
      const list = await listAttachments(tmpDir, "test-project", 42);
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].id, meta.id);

      // Save another
      await saveAttachment(tmpDir, "test-project", 42, {
        buffer: Buffer.from("image data"),
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        uploader: "user456",
      });
      const list2 = await listAttachments(tmpDir, "test-project", 42);
      assert.strictEqual(list2.length, 2);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns empty list for non-existent issue", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-attach-test-"));
    try {
      const list = await listAttachments(tmpDir, "test-project", 999);
      assert.strictEqual(list.length, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("formatAttachmentComment", () => {
  it("formats comment with public URL", () => {
    const comment = formatAttachmentComment([{
      id: "abc", issueId: 42, filename: "photo.jpg", mimeType: "image/jpeg",
      size: 5000, uploader: "alice", uploadedAt: "2024-01-01T00:00:00Z",
      localPath: "abc-photo.jpg", publicUrl: "https://example.com/photo.jpg",
    }]);
    assert.ok(comment.includes("![photo.jpg](https://example.com/photo.jpg)"));
    assert.ok(comment.includes("alice"));
  });

  it("formats comment without public URL", () => {
    const comment = formatAttachmentComment([{
      id: "abc", issueId: 42, filename: "data.csv", mimeType: "text/csv",
      size: 1000, uploader: "bob", uploadedAt: "2024-01-01T00:00:00Z",
      localPath: "abc-data.csv",
    }]);
    assert.ok(comment.includes("**data.csv**"));
    assert.ok(comment.includes("task_attach"));
  });

  it("returns empty for no attachments", () => {
    assert.strictEqual(formatAttachmentComment([]), "");
  });
});

describe("formatAttachmentsForTask", () => {
  it("returns empty string when no attachments", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-attach-test-"));
    try {
      const result = await formatAttachmentsForTask(tmpDir, "test-project", 999);
      assert.strictEqual(result, "");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("includes attachment info for existing attachments", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-attach-test-"));
    try {
      await saveAttachment(tmpDir, "test-project", 42, {
        buffer: Buffer.from("test"),
        filename: "readme.md",
        mimeType: "text/markdown",
        uploader: "charlie",
      });
      const result = await formatAttachmentsForTask(tmpDir, "test-project", 42);
      assert.ok(result.includes("## Attachments"));
      assert.ok(result.includes("readme.md"));
      assert.ok(result.includes("charlie"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("purgeIssueAttachments", () => {
  it("produces a hash manifest and removes only the normalized issue directory", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-attach-purge-"));
    try {
      await saveAttachment(tmpDir, "test-project", 42, {
        buffer: Buffer.from("retained bytes"), filename: "evidence.txt",
        mimeType: "text/plain", uploader: "tester",
      });
      const manifest = await purgeIssueAttachments(tmpDir, "test-project", 42);

      assert.ok(manifest.some((entry) => entry.filename.endsWith("evidence.txt") && entry.sha256.length === 64));
      assert.deepStrictEqual(await listAttachments(tmpDir, "test-project", 42), []);
      await assert.rejects(purgeIssueAttachments(tmpDir, "../escape", 42), /Unsafe project slug/);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

it("does not hide a corrupt attachment index or overwrite it on save", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-corrupt-"));
  try {
    const dir = path.join(root, "devclaw", "attachments", "test-project", "42");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "metadata.json"), "broken");
    await assert.rejects(listAttachments(root, "test-project", 42));
    await assert.rejects(saveAttachment(root, "test-project", 42, { buffer: Buffer.from("new"), filename: "new.txt", mimeType: "text/plain", uploader: "test" }));
    assert.equal(await fs.readFile(path.join(dir, "metadata.json"), "utf8"), "broken");
    assert.deepEqual(await fs.readdir(dir), ["metadata.json"]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("retains every concurrent attachment", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-concurrent-"));
  try {
    const saved = await Promise.all(Array.from({ length: 12 }, (_, i) => saveAttachment(root, "test-project", 42,
      { buffer: Buffer.from(String(i)), filename: `${i}.txt`, mimeType: "text/plain", uploader: "test" })));
    assert.deepEqual(new Set((await listAttachments(root, "test-project", 42)).map(file => file.id)), new Set(saved.map(file => file.id)));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("refuses purge through a project junction", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-link-"));
  try {
    const outside = path.join(root, "outside");
    await fs.mkdir(path.join(outside, "42"), { recursive: true });
    await fs.writeFile(path.join(outside, "42", "keep.txt"), "keep");
    const parent = path.join(root, "devclaw", "attachments");
    await fs.mkdir(parent, { recursive: true });
    await fs.symlink(outside, path.join(parent, "test-project"), "junction");
    await assert.rejects(purgeIssueAttachments(root, "test-project", 42));
    assert.equal(await fs.readFile(path.join(outside, "42", "keep.txt"), "utf8"), "keep");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
