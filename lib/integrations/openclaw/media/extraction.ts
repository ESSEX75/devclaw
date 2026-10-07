/** Normalizes SDK media metadata while preserving positional path/type pairing. */

import path from "node:path";

import type { MediaAttachmentInfo } from "./types.js";

/** Preserve path/type pairing and deduplicate local media paths.
 * @param metadata - SDK-normalized media fields, still untrusted.
 */
export function extractMediaAttachments(metadata: Record<string, unknown>): MediaAttachmentInfo[] {
  const result: MediaAttachmentInfo[] = [];
  const seen = new Set<string>();
  const paths = [metadata.MediaPath, ...(Array.isArray(metadata.MediaPaths) ? metadata.MediaPaths : [])];
  const types = [metadata.MediaType, ...(Array.isArray(metadata.MediaTypes) ? metadata.MediaTypes : [])];

  for (const [index, localPath] of paths.entries()) {
    if (typeof localPath !== "string" || !localPath || seen.has(localPath)) continue;
    seen.add(localPath);
    const mimeType = types[index];

    result.push({ localPath, filename: path.basename(localPath), mimeType: typeof mimeType === "string" ? mimeType : undefined });
  }

  return result;
}
