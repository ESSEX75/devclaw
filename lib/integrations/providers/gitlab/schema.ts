/** Validates GitLab boundary responses before capabilities consume provider data. */

import { z } from "zod";

/** Optional conflict evidence remains unknown unless the provider explicitly supplies valid fields. */
export const GitLabMergeabilitySchema = z.object({
  has_conflicts: z.boolean().optional(),
  detailed_merge_status: z.string().optional(),
});

/** Validates GitLabIssueSchema provider payloads. */
export const GitLabIssueSchema = z.object({
  iid: z.number(), title: z.string(), description: z.string().nullable().transform(value => value ?? ""), labels: z.array(z.string()),
  state: z.string(), web_url: z.string(),
});

/** Related merge-request responses must confirm identity before they can drive observations. */
export const GitLabMRSchema = z.object({
  iid: z.number().int().positive().safe(),
  project_id: z.number().int().positive().safe(),
  title: z.string(),
  description: z.string().nullable().optional().transform(value => value ?? ""),
  web_url: z.string().min(1),
  state: z.enum(["opened", "merged", "closed"]),
  source_branch: z.string().optional(),
  merged_at: z.string().nullable().optional().transform(value => value ?? null),
});

/** Approval evidence must include the explicit reviewers and remaining required approvals. */
export const GitLabApprovalSchema = z.object({ approved_by: z.array(z.unknown()), approvals_left: z.number().int().nonnegative() });

/** GitLab notes keep one shared identity across discussion and conversation endpoints. */
export const GitLabNoteSchema = z.object({ id: z.number().int().positive().safe(), author: z.object({ username: z.string() }), body: z.string(),
  created_at: z.string(), system: z.boolean(), resolvable: z.boolean().optional(), resolved: z.boolean().optional(),
  type: z.string().nullable().optional(),
  position: z.object({ new_path: z.string().optional(), new_line: z.number().nullable().optional() }).nullable().optional() });

/** Discussion pages contain notes whose provider identity must be retained. */
export const GitLabDiscussionSchema = z.object({ notes: z.array(GitLabNoteSchema) });

/** Cosmetic emoji metadata returned in complete reaction collections. */
export const GitLabEmojiSchema = z.object({ name: z.string() });
