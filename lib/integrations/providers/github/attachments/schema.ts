/** Owns github/attachments schema contracts at the concrete provider boundary. */

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
