/** Detects media types through the installed SDK using bytes already read by state. */

/** Detect the MIME type using the installed SDK without reading files in application code.
 * @param filePath - Resolved source filename.
 * @param buffer - File contents already read by state.
 */
export async function detectAttachmentMime(filePath: string, buffer: Buffer): Promise<string | undefined> {
  const { detectMime } = await import("openclaw/plugin-sdk/media-mime");

  return await detectMime({ filePath, buffer }) ?? undefined;
}
