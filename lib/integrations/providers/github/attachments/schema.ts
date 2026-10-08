/** Validates GitHub attachment publication responses before untrusted data enters the owning capability. */

import { z } from "zod";

import { GITHUB_OBJECT_SHA_PATTERN } from "./const.js";

/** Contents API acknowledgement confirms the uploaded resource path, exact object identity and public location. */
export const GhAttachmentSchema = z.object({
  content: z.object({
    path: z.string().min(1),
    sha: z.string().regex(GITHUB_OBJECT_SHA_PATTERN),
    download_url: z.string().url(),
  }),
});
