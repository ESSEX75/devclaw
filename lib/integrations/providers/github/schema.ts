/** Validates GitHub boundary responses before capabilities consume provider data. */

import { z } from "zod";

/** Validates GhIssueSchema provider payloads. */
export const GhIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable().optional(),
  labels: z.array(z.object({ name: z.string() })),
  state: z.string(),
  url: z.string(),
});

/** Validates GhRateLimitSchema provider payloads. */
export const GhRateLimitSchema = z.object({
  resources: z.object({ core: z.object({ remaining: z.number().int().nonnegative(), reset: z.number() }) }),
});

/** Validates repository identity before a successful observation enters the instance cache. */
export const GhRepositorySchema = z.object({ owner: z.object({ login: z.string().min(1) }), name: z.string().min(1) });

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
  state: z.enum(["OPEN", "MERGED", "CLOSED"]), mergedAt: z.string().nullable().optional().transform(value => value ?? null),
  reviewDecision: z.string().nullable().optional().transform(value => value ?? null),
  mergeable: z.string().nullable().optional().transform(value => value ?? null),
});

/** REST pull-request listing fields used for complete fallback discovery. */
export const GhRestPullSchema = z.object({ number: z.number().int().positive().safe(), title: z.string(), body: z.string().nullable(),
  head: z.object({ ref: z.string() }), html_url: z.string().min(1) });

/** Review summaries carry timestamps for selecting the latest formal decision per reviewer. */
export const GhReviewSchema = z.object({ id: z.number().int().positive().safe(), user: z.object({ login: z.string() }),
  body: z.string().nullable().optional().transform(value => value ?? ""), state: z.string(),
  submitted_at: z.string().refine(value => Number.isFinite(Date.parse(value)), "Invalid review timestamp.").nullable() });

/** Complete cosmetic reaction payload used only as an indicator, never a durable receipt. */
export const GhReactionSchema = z.object({ content: z.string() });

/** Conversation comments retain cosmetic reaction counts independently of summary receipts. */
export const GhCommentSchema = z.object({ id: z.number().int().positive().safe(), user: z.object({ login: z.string() }), body: z.string(), created_at: z.string(),
  reactions: z.object({ eyes: z.number().nonnegative().optional() }).optional() });

/** Inline review comments have a namespace distinct from summaries and conversations. */
export const GhInlineSchema = GhCommentSchema.extend({ path: z.string().optional(), line: z.number().nullable().optional() });

/** REST issue collection DTO includes pull-request markers so they are not reported as issues. */
export const GhRestIssueSchema = z.object({ number: z.number().int().positive().safe(), title: z.string(), body: z.string().nullable(),
  labels: z.array(z.object({ name: z.string() })), state: z.string(), html_url: z.string(), pull_request: z.unknown().optional() });
