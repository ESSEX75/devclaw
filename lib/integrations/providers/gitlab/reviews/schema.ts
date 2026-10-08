/** Validates GitLab formal reviews and discussion feedback responses before untrusted data enters the owning capability. */

import { z } from "zod";

import { GitLabNoteSchema } from "../comments/index.js";

/** Approval evidence must include the explicit reviewers and remaining required approvals. */
export const GitLabApprovalSchema = z.object({ approved_by: z.array(z.unknown()), approvals_left: z.number().int().nonnegative() });

/** Discussion pages contain notes whose provider identity must be retained. */
export const GitLabDiscussionSchema = z.object({ notes: z.array(GitLabNoteSchema) });
