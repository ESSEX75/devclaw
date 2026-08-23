import { z } from "zod";

import {
  ISSUE_PROVIDER,
  NOTIFICATION_CHANNEL,
  type NotificationEndpoint,
  type ProjectsData,
} from "../../domain/index.js";

const NonEmptyString = z.string().trim().min(1);

const NotificationEndpointSchema = z.object({
  channelId: NonEmptyString.superRefine((value, context) => {
    if (value.includes(":topic:")) {
      const [channelId, threadId] = value.split(":topic:");

      context.addIssue({
        code: "custom",
        message: `legacy Telegram topic syntax is not supported; use { channelId: "${channelId}", threadId: "${threadId}" }`,
      });
    }
  }),
  channel: z.enum(NOTIFICATION_CHANNEL),
  name: NonEmptyString,
  accountId: NonEmptyString.optional(),
  threadId: NonEmptyString.optional(),
}).strict();

const SlotStateSchema = z.object({
  active: z.boolean(),
  issueId: z.string().nullable(),
  sessionKey: z.string().nullable(),
  startTime: z.string().nullable(),
  previousLabel: z.string().nullable().optional(),
  name: z.string().optional(),
  lastIssueId: z.string().nullable().optional(),
}).strict();

const RoleWorkerStateSchema = z.object({
  levels: z.record(z.string(), z.array(SlotStateSchema).optional()),
}).strict();

const ProjectSchema = z.object({
  slug: NonEmptyString,
  name: NonEmptyString,
  repo: NonEmptyString,
  repoRemote: NonEmptyString.optional(),
  groupName: z.string(),
  deployUrl: z.string(),
  baseBranch: NonEmptyString,
  deployBranch: NonEmptyString,
  channels: z.array(NotificationEndpointSchema).min(1).superRefine((endpoints, context) => {
    const destinations = new Map<string, string>();

    for (const [index, endpoint] of endpoints.entries()) {
      const destination = `${endpoint.channel}\u0000${endpoint.channelId}\u0000${endpoint.threadId ?? ""}`;
      const account = endpoint.accountId ?? "default";
      const existingAccount = destinations.get(destination);

      if (existingAccount !== undefined && existingAccount !== account) {
        context.addIssue({
          code: "custom",
          path: [index, "accountId"],
          message: `destination is already registered with accountId "${existingAccount}"`,
        });
      } else {
        destinations.set(destination, account);
      }
    }
  }),
  provider: z.enum(ISSUE_PROVIDER).optional(),
  workers: z.record(z.string(), RoleWorkerStateSchema),
}).strict();

const ProjectsDataSchema = z.object({
  projects: z.record(z.string(), ProjectSchema),
}).strict();

export function parseProjectsData(value: unknown): ProjectsData {
  return ProjectsDataSchema.parse(value);
}

export function parseNotificationEndpoint(value: unknown): NotificationEndpoint {
  return NotificationEndpointSchema.parse(value);
}
