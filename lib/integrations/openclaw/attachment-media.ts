/** Normalizes SDK media metadata and detects MIME types at the OpenClaw boundary. */
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

/** Detect the MIME type using the installed SDK without reading files in application code.
 * @param filePath - Resolved source filename.
 * @param buffer - File contents already read by state.
 */
export async function detectAttachmentMime(filePath: string, buffer: Buffer): Promise<string | undefined> {
  const { detectMime } = await import("openclaw/plugin-sdk/media-mime");

  return await detectMime({ filePath, buffer }) ?? undefined;
}
