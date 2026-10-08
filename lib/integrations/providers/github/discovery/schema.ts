/** Owns github/discovery schema contracts at the concrete provider boundary. */

import { z } from "zod";

import { GITHUB_REQUEST_STATE } from "../api/index.js";

/** Timeline references may point at other entities; only confirmed PR fields are consumed. */
export const GhTimelineReferenceSchema = z.object({
  number: z.number().int().positive().safe().optional(),
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
  url: z.string().optional(),
  mergedAt: z.string().nullable().optional(),
  reviewDecision: z.string().nullable().optional(),
  state: z.string().optional(),
  mergeable: z.string().nullable().optional(),
});

/** A malformed or partial GraphQL response cannot establish that no linked PR exists. */
export const GhTimelineSchema = z.object({
  errors: z.array(z.unknown()).optional(),
  data: z.object({ repository: z.object({ issue: z.object({ timelineItems: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    nodes: z.array(z.object({ subject: GhTimelineReferenceSchema.nullable().optional(), source: GhTimelineReferenceSchema.nullable().optional() })),
  }) }) }) }),
}).refine(response => !response.errors?.length, "Partial GraphQL response cannot establish PR absence.");

/** Concrete PR observation used consistently by every GitHub operation. */
export const GhPullRequestSchema = z.object({
  number: z.number().int().positive().safe(), title: z.string(), body: z.string().nullable().optional().transform(value => value ?? ""),
  headRefName: z.string().nullable().optional().transform(value => value ?? ""), url: z.string().min(1),
  state: z.enum([GITHUB_REQUEST_STATE.OPEN, GITHUB_REQUEST_STATE.MERGED, GITHUB_REQUEST_STATE.CLOSED]),
  mergedAt: z.string().nullable().optional().transform(value => value ?? null),
  reviewDecision: z.string().nullable().optional().transform(value => value ?? null),
  mergeable: z.string().nullable().optional().transform(value => value ?? null),
});

/** REST pull-request listing fields used for complete fallback discovery. */
export const GhRestPullSchema = z.object({ number: z.number().int().positive().safe(), title: z.string(), body: z.string().nullable(),
  head: z.object({ ref: z.string() }), html_url: z.string().min(1) });
