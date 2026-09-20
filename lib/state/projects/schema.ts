/** Validates the strict current projects-registry persistence contract. */
import { z } from "zod";

import {
  ISSUE_PROVIDER,
  NOTIFICATION_CHANNEL,
  type NotificationEndpoint,
} from "../../domain/index.js";
import type { ProjectsData } from "./types.js";

/** Reusable non-empty string constraint for required registry identifiers and names. */
const NonEmptyString = z.string().trim().min(1);

/** Strict lowercase kebab-case project slug accepted by every state filesystem boundary. */
const ProjectSlugSchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "must use lowercase kebab-case",
);

/** Strict schema for one configured notification endpoint. */
const NotificationEndpointSchema = z.object({
  channelId: NonEmptyString,
  channel: z.enum(NOTIFICATION_CHANNEL),
  name: NonEmptyString,
  accountId: NonEmptyString,
  threadId: NonEmptyString.optional(),
}).strict();

/** Positive provider-local issue identifier accepted by worker slots. */
const SlotIssueIdSchema = z.number().int().positive();

/** Strict schema for one persisted worker slot. */
const SlotStateSchema = z.object({
  active: z.boolean(),
  issueId: SlotIssueIdSchema.nullable(),
  sessionKey: z.string().nullable(),
  startTime: z.string().nullable(),
  previousLabel: z.string().nullable().optional(),
  name: z.string().optional(),
  lastIssueId: SlotIssueIdSchema.nullable().optional(),
}).strict();

/** Strict schema for the level-indexed slots assigned to one role. */
const RoleWorkerStateSchema = z.object({
  levels: z.record(z.string(), z.array(SlotStateSchema).optional()),
}).strict();

/** Strict schema for one registered project and its persisted worker state. */
const ProjectSchema = z.object({
  slug: ProjectSlugSchema,
  name: NonEmptyString,
  agentId: NonEmptyString,
  repo: NonEmptyString,
  baseBranch: NonEmptyString,
  deployBranch: NonEmptyString,
  channels: z.array(NotificationEndpointSchema).min(1),
  provider: z.enum(ISSUE_PROVIDER),
  workers: z.record(z.string(), RoleWorkerStateSchema),
}).strict();

/** Strict schema for the complete projects registry, including unique notification destinations. */
const ProjectsDataSchema = z.object({
  projects: z.record(ProjectSlugSchema, ProjectSchema),
}).strict().superRefine((data, context) => {
  const destinations = new Map<string, string>();

  for (const [slug, project] of Object.entries(data.projects)) {
    if (project.slug !== slug) {
      context.addIssue({
        code: "custom",
        path: ["projects", slug, "slug"],
        message: `must match registry key "${slug}"`,
      });
    }

    for (const [index, endpoint] of project.channels.entries()) {
      const destination = [
        endpoint.channel,
        endpoint.accountId,
        endpoint.channelId,
        endpoint.threadId ?? "",
      ].join("\u0000");
      const existingProject = destinations.get(destination);

      if (existingProject !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["projects", slug, "channels", index],
          message: `destination is already registered by project "${existingProject}"`,
        });
      } else {
        destinations.set(destination, slug);
      }
    }
  }
});

/**
 * Parse an unknown value as the complete current projects registry.
 *
 * @param value - Untrusted value read at or supplied to the persistence boundary.
 */
export function parseProjectsData(value: unknown): ProjectsData {
  return ProjectsDataSchema.parse(value);
}

/**
 * Validate one canonical project slug before it participates in state addressing.
 *
 * @param value - Untrusted project identifier supplied by a caller or filesystem boundary.
 */
export function parseProjectSlug(value: unknown): string {
  return ProjectSlugSchema.parse(value);
}

/**
 * Parse an unknown value as one strict notification endpoint.
 *
 * @param value - Untrusted endpoint value supplied at a registration boundary.
 */
export function parseNotificationEndpoint(value: unknown): NotificationEndpoint {
  return NotificationEndpointSchema.parse(value);
}
