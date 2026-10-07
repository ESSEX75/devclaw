/** Proves malformed or duplicate SDK media fields cannot shift MIME ownership to another file. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { extractMediaAttachments } from "./index.js";

it("preserves positional MIME pairing when paths or types are invalid", () => {
  assert.deepEqual(extractMediaAttachments({ MediaPaths: [null, "/tmp/b.pdf", "/tmp/c.png"],
    MediaTypes: ["image/jpeg", false, "image/png"] }).map(file => [file.localPath, file.mimeType]),
  [["/tmp/b.pdf", undefined], ["/tmp/c.png", "image/png"]]);
});

it("captures a path only once when the SDK repeats it in single and plural fields", () => {
  assert.equal(extractMediaAttachments({ MediaPath: "/tmp/a.png", MediaType: "image/png",
    MediaPaths: ["/tmp/a.png"], MediaTypes: ["image/png"] }).length, 1);
});
