/** Validates attachment index JSON without legacy coercion or recovery-by-overwrite. */
import { z } from "zod";

import { SAFE_ATTACHMENT_NAME } from "./const.js";
import type { AttachmentStore } from "./types.js";

/** Basename-only storage reference, rejecting traversal and platform separators. */
export const attachmentNameSchema = z.string().min(1).regex(SAFE_ATTACHMENT_NAME).refine(value => value !== "." && value !== "..");
/** Persisted attachment fields; invalid data must remain available for explicit repair. */
const attachmentSchema = z.object({
  id: z.string().min(1), issueId: z.number().int().positive().safe(), filename: z.string().min(1),
  mimeType: z.string().min(1), size: z.number().int().nonnegative().safe(), uploader: z.string(),
  uploadedAt: z.string().datetime(), localPath: attachmentNameSchema, publicUrl: z.string().url().optional(),
}).strict();
/** Strict current store envelope. */
const storeSchema = z.object({ attachments: z.array(attachmentSchema) }).strict();

/** Check issue ownership and unique identities after validating the persisted shape.
 * @param value - Untrusted JSON value.
 * @param issueId - Issue addressed by the repository operation.
 */
export function parseAttachmentStore(value: unknown, issueId: number): AttachmentStore {
  const store = storeSchema.parse(value);

  if (store.attachments.some(file => file.issueId !== issueId)
    || new Set(store.attachments.map(file => file.id)).size !== store.attachments.length
    || new Set(store.attachments.map(file => file.localPath)).size !== store.attachments.length) {
    throw new Error("Attachment index contains mismatched issue ownership or duplicate file identities.");
  }

  return store;
}
