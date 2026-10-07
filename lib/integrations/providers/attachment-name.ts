/** Flattens untrusted display names according to shared external attachment resource policy. */

import { PROVIDER_ATTACHMENT_STORAGE } from "./const.js";

/** Build a bounded flat name; transports add their own resource or temporary-file prefix.
 * @param filename - Untrusted original display name retained separately by application/state.
 */
export function sanitizeProviderAttachmentName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, PROVIDER_ATTACHMENT_STORAGE.MAX_NAME_LENGTH)
    || PROVIDER_ATTACHMENT_STORAGE.FALLBACK_NAME;
}
