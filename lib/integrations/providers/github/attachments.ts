/** Owns GitHub attachments operations and their provider-specific API semantics. */

import { randomUUID } from "node:crypto";

import { sanitizeProviderAttachmentName } from "../attachment-name.js";
import { PROVIDER_OPERATION_ERROR } from "../errors/index.js";
import { normalizeProviderFailure } from "../errors/index.js";
import type { ProviderTransport } from "../transport/index.js";
import { PROVIDER_HTTP_METHOD } from "../transport/index.js";
import { parseProviderJson } from "../transport/index.js";
import type { AttachmentUploadInput } from "../types.js";
import { GITHUB_API_RESOURCE, GITHUB_ATTACHMENT_STORAGE,GITHUB_QUERY } from "./const.js";
import { githubRepositoryPath } from "./endpoints.js";
import { GitHubRepository } from "./repository.js";
import { GhAttachmentSchema } from "./schema.js";

/** Implements the attachments capability using dependencies shared by one adapter instance. */
export class GitHubAttachments {
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   * @param repository - Shared repository capability for this adapter.
   */
  constructor(private readonly transport: ProviderTransport, private readonly repository: GitHubRepository) {}

  /** Publish bytes once and return only a location confirmed by the Contents API response.
   * Unavailable or unidentified uploads preserve application-owned local attachment bytes.
   * @param issueId - Provider issue identity used to isolate the repository resource.
   * @param file - Persisted bytes and untrusted display metadata.
   */
  async uploadAttachment(
    issueId: number,
    file: AttachmentUploadInput,
  ): Promise<string | null> {
    try {
      const branch = GITHUB_ATTACHMENT_STORAGE.BRANCH;
      const safeFilename = sanitizeProviderAttachmentName(file.filename);
      const filePath = `${GITHUB_ATTACHMENT_STORAGE.DIRECTORY}/${issueId}/${randomUUID()}-${safeFilename}`;
      const base64Content = file.buffer.toString("base64");

      // Get repo owner/name
      const repo = await this.repository.getRepoInfo();

      // Ensure branch exists
      let branchExists = false;

      try {
        await this.transport.read(["api", githubRepositoryPath(repo, GITHUB_API_RESOURCE.GIT, GITHUB_API_RESOURCE.REF, GITHUB_API_RESOURCE.HEADS, branch)]);
        branchExists = true;
      } catch (error) {
        const failure = normalizeProviderFailure(error);

        if (failure.code !== PROVIDER_OPERATION_ERROR.NOT_FOUND || failure.outcomeUnknown) throw error;
      }

      if (!branchExists) {
        const raw = await this.transport.read([
          "repo", "view", "--json", GITHUB_QUERY.DEFAULT_BRANCH_FIELD, "--jq", GITHUB_QUERY.DEFAULT_BRANCH_SELECTOR,
        ]);
        const defaultBranch = raw.trim();
        const shaRaw = await this.transport.read([
          "api", githubRepositoryPath(repo, GITHUB_API_RESOURCE.GIT, GITHUB_API_RESOURCE.REF, GITHUB_API_RESOURCE.HEADS, defaultBranch),
          "--jq", GITHUB_QUERY.OBJECT_SHA_SELECTOR,
        ]);

        await this.transport.once([
          "api", githubRepositoryPath(repo, GITHUB_API_RESOURCE.GIT, GITHUB_API_RESOURCE.REFS),
          "--method", PROVIDER_HTTP_METHOD.POST,
          "--field", `ref=refs/heads/${branch}`,
          "--field", `sha=${shaRaw.trim()}`,
        ]);
      }

      // Upload via Contents API; a clean exit alone does not confirm the uploaded identity.
      const output = await this.transport.once([
        "api", githubRepositoryPath(repo, GITHUB_API_RESOURCE.CONTENTS, filePath),
        "--method", PROVIDER_HTTP_METHOD.PUT,
        "--field", `message=attachment: ${file.filename} for issue #${issueId}`,
        "--field", `content=${base64Content}`,
        "--field", `branch=${branch}`,
      ]);

      const uploaded = parseProviderJson(output, GhAttachmentSchema);

      if (uploaded.content.path !== filePath) return null;
      const url = new URL(uploaded.content.download_url);

      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;

      return url.href;
    } catch {
      return null;
    }
  }
}
