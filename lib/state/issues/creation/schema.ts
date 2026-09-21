/**
 * Validates the only supported managed-issue creation operation store schema.
 */
import { z } from "zod";

import {
  ISSUE_CREATION_ERROR,
  ISSUE_CREATION_STATUS,
  ISSUE_PROVIDER,
  NOTIFICATION_CHANNEL,
  REVIEW_POLICY,
  TEST_POLICY,
} from "../../../domain/index.js";
import type { IssueCreationStore } from "./types.js";

/** Strict schema for the immutable input captured by a creation operation. */
const CreationInputSchema = z.object({
  title: z.string(), body: z.string(), assignees: z.array(z.string()),
  workflowState: z.string(), workflowLabel: z.string(), assignedRole: z.string().nullable(),
  assignedLevel: z.string().nullable(), owner: z.string().nullable(),
  reviewPolicy: z.enum(REVIEW_POLICY), testPolicy: z.enum(TEST_POLICY),
  notifyTarget: z.object({ channel: z.enum(NOTIFICATION_CHANNEL), name: z.string() }).strict().nullable(),
  provider: z.enum(ISSUE_PROVIDER),
}).strict();
/** Strict schema for the last durable creation failure. */
const CreationFailureSchema = z.object({
  code: z.enum(ISSUE_CREATION_ERROR), message: z.string(), retryable: z.boolean(), retryAfter: z.string().optional(),
}).strict();
/** Strict schema for one resumable issue-creation operation. */
const CreationOperationSchema = z.object({
  operationId: z.string().uuid(), idempotencyKey: z.string().min(1), payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  projectSlug: z.string(), requestedBy: z.string(), requestedAt: z.string(), updatedAt: z.string(),
  status: z.enum(ISSUE_CREATION_STATUS), input: CreationInputSchema, expectedLabels: z.array(z.string()),
  providerIssue: z.object({ issueId: z.number().int().positive(), url: z.string(), createdAt: z.string() }).strict().optional(),
  completedSteps: z.array(z.string()), pendingSteps: z.array(z.string()), attempts: z.number().int().nonnegative(),
  retryAfter: z.string().optional(), lastError: CreationFailureSchema.optional(), auditCorrelationId: z.string().uuid(),
}).strict();
/** Strict schema for the current issue-creation store envelope. */
const CreationStoreSchema = z.object({
  projectSlug: z.string(), operations: z.record(z.string(), CreationOperationSchema),
}).strict();

/**
 * Parse creation operations and enforce their owning project slug.
 *
 * @param value - Untrusted JSON-compatible creation store value.
 * @param projectSlug - Project expected to own every operation.
 */
export function parseIssueCreationStore(value: unknown, projectSlug: string): IssueCreationStore {
  const store = CreationStoreSchema.parse(value);

  if (store.projectSlug !== projectSlug) {
    throw new Error(`Issue creation store projectSlug mismatch: expected ${projectSlug}, got ${store.projectSlug}`);
  }

  for (const [operationKey, operation] of Object.entries(store.operations)) {
    if (operationKey !== operation.idempotencyKey) {
      throw new Error(`Issue creation key mismatch: expected ${operation.idempotencyKey}, got ${operationKey}`);
    }

    if (operation.projectSlug !== projectSlug) {
      throw new Error(`Issue creation operation projectSlug mismatch: expected ${projectSlug}, got ${operation.projectSlug}`);
    }
  }

  return store;
}
