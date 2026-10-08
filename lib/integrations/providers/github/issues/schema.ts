/** Validates GitHub issue observations and explicit mutations responses before untrusted data enters the owning capability. */

import { z } from "zod";

import { ProviderIdentitySchema } from "../../transport/index.js";

/** Validates GhIssueSchema provider payloads. */
export const GhIssueSchema = z.object({
  number: ProviderIdentitySchema,
  title: z.string(),
  body: z.string().nullable().optional(),
  labels: z.array(z.object({ name: z.string() })),
  state: z.string(),
  url: z.string(),
});

/** REST issue collection DTO includes pull-request markers so they are not reported as issues. */
export const GhRestIssueSchema = z.object({ number: z.number().int().positive().safe(), title: z.string(), body: z.string().nullable(),
  labels: z.array(z.object({ name: z.string() })), state: z.string(), html_url: z.string(), pull_request: z.unknown().optional() });
