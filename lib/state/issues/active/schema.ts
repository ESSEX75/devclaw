/**
 * Validates the only supported active managed-issue store schema.
 */
import { z } from "zod";

import {
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
  NOTIFICATION_CHANNEL,
  PIPELINE_NOTIFICATION_STATUS,
  REVIEW_POLICY,
  TEST_POLICY,
} from "../../../domain/index.js";
import type { IssueStateStore } from "./types.js";

const RuntimeIssueSchema = z.object({
  projectSlug: z.string(), issueId: z.number().int().positive(), provider: z.enum(ISSUE_PROVIDER),
  creationOperationId: z.string().uuid().optional(),
  workflowState: z.string(), workflowLabel: z.string(), assignedRole: z.string().nullable(),
  assignedLevel: z.string().nullable(), owner: z.string().nullable(),
  reviewPolicy: z.enum(REVIEW_POLICY).nullable(), testPolicy: z.enum(TEST_POLICY).nullable(),
  notifyTarget: z.object({ channel: z.enum(NOTIFICATION_CHANNEL), name: z.string() }).strict().nullable(),
  activeWorker: z.object({
    role: z.string(), level: z.string(), slotIndex: z.number().int().nonnegative(),
    sessionKey: z.string().nullable(), startedAt: z.string(),
  }).strict().nullable(),
  integrityStatus: z.enum(ISSUE_INTEGRITY_STATUS), integrityErrors: z.array(z.string()),
  projectionVersion: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string(),
  closedAt: z.string().nullable(),
  providerMissing: z.object({
    confirmations: z.number().int().positive(), firstConfirmedAt: z.string(), lastConfirmedAt: z.string(),
  }).strict().nullable(),
  pipelineNotification: z.object({
    eventKey: z.string(), status: z.enum(PIPELINE_NOTIFICATION_STATUS),
    attemptedAt: z.string(), deliveredAt: z.string().optional(),
  }).strict().nullable(),
}).strict();

const IssueStateStoreSchema = z.object({
  version: z.literal(2), projectSlug: z.string(), issues: z.record(z.string(), RuntimeIssueSchema),
}).strict();

/**
 * Parse active state and enforce its owning project slug.
 *
 * @param value - Untrusted JSON-compatible active store value.
 * @param projectSlug - Project expected to own the store.
 */
export function parseIssueStateStore(value: unknown, projectSlug: string): IssueStateStore {
  const store = IssueStateStoreSchema.parse(value);

  if (store.projectSlug !== projectSlug) {
    throw new Error(`Issue store projectSlug mismatch: expected ${projectSlug}, got ${store.projectSlug}`);
  }

  return store;
}
