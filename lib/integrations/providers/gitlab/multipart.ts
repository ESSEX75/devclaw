/** Owns GitLab multipart uploads, validated installation URLs and isolated temporary bytes. */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import type { RunCommand } from "../../../context.js";
import { sanitizeProviderAttachmentName } from "../attachments/index.js";
import { parseProviderJson,PROVIDER_HTTP_METHOD, runProviderCommand } from "../transport/index.js";
import { gitlabApiPath } from "./api/index.js";
import { GITLAB_ATTACHMENT_STORAGE, GITLAB_FILENAME_CONTROL_LIMIT, GITLAB_UPLOAD_PATH, GITLAB_UPLOAD_PATH_PATTERN } from "./attachments/index.js";

/** Provider-confirmed identity needed to distinguish installation prefixes from nested namespaces. */
const projectSchema = z.object({
  id: z.number().int().positive().safe(),
  web_url: z.string().url(),
  path_with_namespace: z.string().min(1),
});

/** Upload locations remain untrusted even after a clean process exit. */
const uploadSchema = z.object({ url: z.string().optional(), full_path: z.string().optional() });

/** Stage bytes under a generated directory and submit exactly once; all failure paths attempt cleanup.
 * The project response supplies the complete namespace, preserving self-hosted installation prefixes.
 * No response path may escape the confirmed project's upload resources.
 * @param runCommand - Plugin-owned process transport.
 * @param repoPath - Repository selecting the provider configuration.
 * @param read - Adapter read transport with its existing resilience policy.
 * @param filename - Untrusted display name, flattened before use on disk.
 * @param buffer - Already locally persisted attachment bytes.
 */
export async function uploadGitLabAttachment(runCommand: RunCommand, repoPath: string,
  read: (args: string[]) => Promise<string>, filename: string, buffer: Buffer): Promise<string> {
  const project = parseProviderJson(await read(["api", gitlabApiPath(), "--method", PROVIDER_HTTP_METHOD.GET]), projectSchema);
  const webUrl = new URL(project.web_url);

  if (!["https:", "http:"].includes(webUrl.protocol) || webUrl.username || webUrl.password || webUrl.search || webUrl.hash) {
    throw new Error("Invalid GitLab project URL.");
  }

  const namespace = project.path_with_namespace.split("/");

  if (namespace.length < 2 || namespace.some(segment => !segment || segment === "." || segment === ".." || /[\\?#%]/.test(segment))) {
    throw new Error("Invalid GitLab namespace.");
  }

  const projectPath = `/${namespace.map(segment => encodeURIComponent(segment)).join("/")}`;
  const webPath = webUrl.pathname.replace(/\/$/, "");

  if (!webPath.endsWith(projectPath)) throw new Error("GitLab project URL does not match its namespace.");
  const installationPath = webPath.slice(0, -projectPath.length);
  const installationUrl = `${webUrl.origin}${installationPath}`;
  const token = (await read(["config", "get", "token", "--host", webUrl.host])).trim();

  if (!token || /[\r\n]/.test(token)) throw new Error("GitLab upload credentials are unavailable.");

  const safeName = sanitizeProviderAttachmentName(filename);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), GITLAB_ATTACHMENT_STORAGE.TEMP_PREFIX));

  try {
    const tmpFile = path.join(tmpDir, `${GITLAB_ATTACHMENT_STORAGE.FILE_PREFIX}${safeName}`);

    await fs.writeFile(tmpFile, buffer, { flag: GITLAB_ATTACHMENT_STORAGE.CREATE_FLAG, mode: GITLAB_ATTACHMENT_STORAGE.FILE_MODE });
    // Curl parses multipart syntax itself; quoting also protects commas and semicolons in trusted temp roots.
    const curlPath = path.sep === "\\" ? tmpFile.replace(/\\/g, "/") : tmpFile;
    const quotedFile = curlPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const output = await runProviderCommand(runCommand, ["curl", "--disable", "--silent", "--fail", "--show-error",
      "--header", `PRIVATE-TOKEN: ${token}`, "--form", `file=@"${quotedFile}"`,
      `${installationUrl}${GITLAB_UPLOAD_PATH.API}${project.id}${GITLAB_UPLOAD_PATH.ENDPOINT}`], repoPath);
    const upload = parseProviderJson(output, uploadSchema);
    const relativePath = upload.url;

    if (relativePath !== undefined) {
      validateUploadPath(relativePath);

      return `${webUrl.origin}${webPath}${relativePath}`;
    }

    const fullPath = upload.full_path;

    if (!fullPath) throw new Error("GitLab upload response has no confirmed location.");
    const scopedPath = installationPath && fullPath.startsWith(`${installationPath}/`)
      ? fullPath.slice(installationPath.length) : fullPath;
    const prefix = scopedPath.startsWith(`${projectPath}${GITLAB_UPLOAD_PATH.FILES}`)
      ? projectPath : `${GITLAB_UPLOAD_PATH.PROJECT}${project.id}`;

    if (!scopedPath.startsWith(`${prefix}${GITLAB_UPLOAD_PATH.FILES}`)) throw new Error("Foreign GitLab upload location.");
    validateUploadPath(scopedPath.slice(prefix.length));

    return `${installationUrl}${scopedPath}`;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: GITLAB_ATTACHMENT_STORAGE.CLEANUP_RETRIES, retryDelay: GITLAB_ATTACHMENT_STORAGE.CLEANUP_DELAY_MS });
  }
}

/** Reject paths whose decoding or URL normalization can leave the project's upload resource.
 * @param value - Provider-relative upload path with one secret and one filename.
 */
function validateUploadPath(value: string): void {
  if (!GITLAB_UPLOAD_PATH_PATTERN.test(value)) throw new Error("Invalid GitLab upload path.");
  const filename = decodeURIComponent(value.slice(value.lastIndexOf("/") + 1));

  if (!filename || filename === "." || filename === ".." || filename.includes("/") || filename.includes("\\")
    || Array.from(filename).some(character => character.charCodeAt(0) < GITLAB_FILENAME_CONTROL_LIMIT)) {
    throw new Error("Invalid GitLab upload filename.");
  }
}
