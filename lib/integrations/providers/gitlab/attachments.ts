/** Owns GitLab attachments operations and their provider-specific API semantics. */

import type { AttachmentUploadInput, ProviderTransport } from "../types.js";
import { uploadGitLabAttachment } from "./multipart.js";

/** Implements the attachments capability using dependencies shared by one adapter instance. */
export class GitLabAttachments {
  /** Bind the concrete capability to its owning adapter.
   * @param transport - Instance-owned checked command transport.
   */
  constructor(private readonly transport: ProviderTransport) {}

  /** Publish already saved bytes once; unavailable or unconfirmed uploads leave the local attachment usable.
   * @param issueId - Provider issue identity; GitLab uploads are scoped to its project.
   * @param file - Persisted bytes and untrusted display metadata.
   */
  async uploadAttachment(
    issueId: number,
    file: AttachmentUploadInput,
  ): Promise<string | null> {
    try {
      return await uploadGitLabAttachment(this.transport.runCommand, this.transport.repoPath, args => this.transport.read(args), file.filename, file.buffer);
    } catch { return null; }
  }
}
