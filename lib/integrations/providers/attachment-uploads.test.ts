/** Exercises real provider upload boundaries, temporary-file lifecycle and confirmed URL handling. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";

import type { RunCommand } from "../../context.js";
import { GitHubProvider } from "./github.js";
import { GitLabProvider } from "./gitlab.js";

/** Deterministic process completion for provider-facing fixtures.
 * @param stdout - Serialized provider response.
 */
function success(stdout: string): Awaited<ReturnType<RunCommand>> {
  return { stdout, stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
}

/** Extract the quoted multipart path so tests inspect the actual uploaded bytes.
 * @param argv - Transport argument vector.
 */
function stagedFile(argv: string[]): string {
  const form = argv[argv.indexOf("--form") + 1];
  assert.ok(form?.startsWith('file=@"') && form.endsWith('"'));
  return form.slice(7, -1);
}

/** Shared documented upload secret used to test provider resource scoping. */
const secret = "a".repeat(32);

for (const [webUrl, namespace, installation] of [
  ["https://gitlab.com/team/repo", "team/repo", "https://gitlab.com"],
  ["https://gitlab.com/team/group/sub/repo", "team/group/sub/repo", "https://gitlab.com"],
  ["https://git.example.test:8443/team/sub/repo", "team/sub/repo", "https://git.example.test:8443"],
  ["https://git.example.test/gitlab/team/sub/repo", "team/sub/repo", "https://git.example.test/gitlab"],
]) {
  for (const responseKind of ["url", "full_path", "legacy_full_path", "prefixed_full_path"]) {
    it(`GitLab resolves ${responseKind} at ${webUrl}`, async () => {
      let temporaryFile = "";
      let uploads = 0;
      const projectResource = responseKind === "legacy_full_path" ? `/${namespace}` : "/-/project/7";
      const relative = `/uploads/${secret}/evidence.txt`;
      const fullPath = `${projectResource}${relative}`;
      const prefix = new URL(installation).pathname.replace(/\/$/, "");
      const response = responseKind === "url" ? { url: relative, full_path: fullPath }
        : { full_path: responseKind === "prefixed_full_path" ? `${prefix}${fullPath}` : fullPath };
      const runCommand: RunCommand = async argv => {
        if (argv[0] === "glab" && argv[1] === "api") return success(JSON.stringify({ id: 7, web_url: webUrl, path_with_namespace: namespace }));
        if (argv[0] === "glab") {
          assert.deepEqual(argv.slice(1), ["config", "get", "token", "--host", new URL(webUrl).host]);
          return success("test-token");
        }
        uploads++;
        assert.equal(argv.at(-1), `${installation}/api/v4/projects/7/uploads`);
        temporaryFile = stagedFile(argv);
        assert.equal(await fs.readFile(temporaryFile, "utf8"), "evidence");
        return success(JSON.stringify(response));
      };
      const url = await new GitLabProvider({ repoPath: ".", runCommand }).uploadAttachment(42,
        { filename: "evidence.txt", buffer: Buffer.from("evidence"), mimeType: "text/plain" });
      assert.equal(url, responseKind === "url" ? `${webUrl}${relative}` : `${installation}${fullPath}`);
      assert.equal(uploads, 1);
      await assert.rejects(fs.stat(path.dirname(temporaryFile)), { code: "ENOENT" });
    });
  }
}

for (const failure of ["transport", "timeout", "malformed", "foreign", "traversal", "missing"]) {
  it(`GitLab cleans up and never replays an upload after ${failure}`, async () => {
    let temporaryFile = "";
    let uploads = 0;
    const runCommand: RunCommand = async argv => {
      if (argv[0] === "glab") return success(argv[1] === "api"
        ? '{"id":7,"web_url":"https://git.test/team/repo","path_with_namespace":"team/repo"}' : "test-token");
      uploads++;
      temporaryFile = stagedFile(argv);
      assert.match(path.basename(temporaryFile), /^attachment-/);
      assert.equal(await fs.readFile(temporaryFile, "utf8"), "evidence");
      if (failure === "transport") throw new Error("HTTP 503 lost response");
      if (failure === "timeout") return { ...success("{}"), termination: "timeout", code: null, killed: true };
      if (failure === "malformed") return success("{broken");
      if (failure === "foreign") return success(JSON.stringify({ full_path: `/-/project/8/uploads/${secret}/file.txt` }));
      if (failure === "traversal") return success(JSON.stringify({ url: `/uploads/${secret}/%2e%2e` }));
      return success("{}");
    };
    assert.equal(await new GitLabProvider({ repoPath: ".", runCommand }).uploadAttachment(42,
      { filename: '../../outside\\CON;file.txt', buffer: Buffer.from("evidence"), mimeType: "text/plain" }), null);
    assert.equal(uploads, 1);
    await assert.rejects(fs.stat(path.dirname(temporaryFile)), { code: "ENOENT" });
  });
}

it("GitLab removes its staging directory when writing bytes fails before transport", async t => {
  let temporaryFile = "";
  let uploads = 0;
  const writeFile = fs.writeFile;
  t.mock.method(fs, "writeFile", async (file: Parameters<typeof fs.writeFile>[0], data: Parameters<typeof fs.writeFile>[1]) => {
    temporaryFile = String(file);
    await writeFile(file, data);
    throw new Error("disk full after partial write");
  });
  const runCommand: RunCommand = async argv => {
    if (argv[0] !== "glab") { uploads++; throw new Error("unexpected upload"); }
    return success(argv[1] === "api"
      ? '{"id":7,"web_url":"https://git.test/team/repo","path_with_namespace":"team/repo"}' : "test-token");
  };
  assert.equal(await new GitLabProvider({ repoPath: ".", runCommand }).uploadAttachment(42,
    { filename: "evidence.txt", buffer: Buffer.from("evidence"), mimeType: "text/plain" }), null);
  assert.equal(uploads, 0);
  assert.ok(temporaryFile);
  await assert.rejects(fs.stat(path.dirname(temporaryFile)), { code: "ENOENT" });
});

it("GitLab rejects contradictory project context before reading credentials or uploading", async () => {
  let calls = 0;
  const runCommand: RunCommand = async () => {
    calls++;
    return success('{"id":7,"web_url":"https://git.test/other/repo","path_with_namespace":"team/repo"}');
  };
  assert.equal(await new GitLabProvider({ repoPath: ".", runCommand }).uploadAttachment(42,
    { filename: "evidence.txt", buffer: Buffer.from("evidence"), mimeType: "text/plain" }), null);
  assert.equal(calls, 1);
});

for (const resultKind of ["confirmed", "missing", "foreign", "invalid_url", "temporary_url", "timeout"]) {
  it(`GitHub publishes only a confirmed Contents response: ${resultKind}`, async () => {
    let uploads = 0;
    const runCommand: RunCommand = async argv => {
      if (argv[1] === "repo") return success('{"owner":{"login":"owner"},"name":"repo"}');
      if (!argv.includes("PUT")) return success('{"object":{"sha":"abc"}}');
      uploads++;
      const filePath = argv[2]?.split("/contents/")[1];
      assert.ok(filePath);
      if (resultKind === "timeout") return { ...success("{}"), termination: "timeout", code: null, killed: true };
      if (resultKind === "missing") return success("{}");
      return success(JSON.stringify({ content: { path: resultKind === "foreign" ? "other.txt" : filePath,
        sha: "a".repeat(40), download_url: resultKind === "invalid_url" ? "javascript:alert(1)"
          : resultKind === "temporary_url" ? "https://raw.git.test/confirmed.txt?token=temporary" : "https://raw.git.test/confirmed.txt" } }));
    };
    const url = await new GitHubProvider({ repoPath: ".", runCommand }).uploadAttachment(42,
      { filename: "../evidence.txt", buffer: Buffer.from("evidence"), mimeType: "text/plain" });
    assert.equal(url, resultKind === "confirmed" ? "https://raw.git.test/confirmed.txt" : null);
    assert.equal(uploads, 1);
  });
}
