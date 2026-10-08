/** Validates GitLab associated request discovery responses before untrusted data enters the owning capability. */

import { z } from "zod";

import { GITLAB_REQUEST_STATE } from "../api/index.js";

/** Optional conflict evidence remains unknown unless the provider explicitly supplies valid fields. */
export const GitLabMergeabilitySchema = z.object({
  has_conflicts: z.boolean().optional(),
  detailed_merge_status: z.string().optional(),
});

/** Related merge-request responses must confirm identity before they can drive observations. */
export const GitLabMRSchema = z.object({
  iid: z.number().int().positive().safe(),
  project_id: z.number().int().positive().safe(),
  title: z.string(),
  description: z.string().nullable().optional().transform(value => value ?? ""),
  web_url: z.string().min(1),
  state: z.enum([GITLAB_REQUEST_STATE.OPEN, GITLAB_REQUEST_STATE.MERGED, GITLAB_REQUEST_STATE.CLOSED]),
  source_branch: z.string().optional(),
  merged_at: z.string().nullable().optional().transform(value => value ?? null),
});
