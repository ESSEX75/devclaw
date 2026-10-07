/** Owns GitHub attachments operations and their provider-specific API semantics. */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { PROVIDER_ATTACHMENT_STORAGE } from "../const.js";
import { normalizeProviderFailure } from "../failures.js";
import { PROVIDER_OPERATION_ERROR } from "../operation-errors.js";
import type {
  AttachmentUploadInput,
  ProviderTransport,
} from "../types.js";
import { GITHUB_ATTACHMENT_STORAGE } from "./const.js";
import { GitHubRepository } from "./repository.js";

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
      const safeFilename = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, PROVIDER_ATTACHMENT_STORAGE.MAX_NAME_LENGTH) || PROVIDER_ATTACHMENT_STORAGE.FALLBACK_NAME;
      const filePath = `${GITHUB_ATTACHMENT_STORAGE.DIRECTORY}/${issueId}/${randomUUID()}-${safeFilename}`;
      const base64Content = file.buffer.toString("base64");

      // Get repo owner/name
      const repo = await this.repository.getRepoInfo();


      // Ensure branch exists
      let branchExists = false;

      try {
        await this.transport.read(["api", `repos/${repo.owner}/${repo.name}/git/ref/heads/${branch}`]);
        branchExists = true;
      } catch (error) {
        const failure = normalizeProviderFailure(error);

        if (failure.code !== PROVIDER_OPERATION_ERROR.NOT_FOUND || failure.outcomeUnknown) throw error;
      }

      if (!branchExists) {
        const raw = await this.transport.read([
          "repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name",
        ]);
        const defaultBranch = raw.trim();
        const shaRaw = await this.transport.read([
          "api", `repos/${repo.owner}/${repo.name}/git/ref/heads/${defaultBranch}`,
          "--jq", ".object.sha",
        ]);

        await this.transport.once([
          "api", `repos/${repo.owner}/${repo.name}/git/refs`,
          "--method", "POST",
          "--field", `ref=refs/heads/${branch}`,
          "--field", `sha=${shaRaw.trim()}`,
        ]);
      }

      // Upload via Contents API; a clean exit alone does not confirm the uploaded identity.
      const output = await this.transport.once([
        "api", `repos/${repo.owner}/${repo.name}/contents/${filePath}`,
        "--method", "PUT",
        "--field", `message=attachment: ${file.filename} for issue #${issueId}`,
        "--field", `content=${base64Content}`,
        "--field", `branch=${branch}`,
      ]);

      const uploaded = z.object({ content: z.object({
        path: z.literal(filePath), sha: z.string().regex(/^[a-fA-F0-9]{40}$/), download_url: z.string().url(),
      }) }).parse(JSON.parse(output));
      const url = new URL(uploaded.content.download_url);

      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;

      return url.href;
    } catch {
      return null;
    }
  }
}
