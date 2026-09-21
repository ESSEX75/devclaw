/**
 * Validates the only supported managed-issue archive schema.
 */
import { z } from "zod";

import {
  ATTACHMENT_DISPOSITION,
  ISSUE_ARCHIVE_REASON,
  ISSUE_INTEGRITY_STATUS,
  ISSUE_PROVIDER,
} from "../../../domain/index.js";
import { issueArchiveKey } from "./identity.js";
import type { IssueArchiveStore } from "./types.js";

/** Strict schema for one immutable archived issue record. */
const ArchivedIssueSchema = z.object({
  projectSlug: z.string(), issueId: z.number().int().positive(), provider: z.enum(ISSUE_PROVIDER),
  title: z.string().optional(), issueUrl: z.string().optional(), finalWorkflowState: z.string(),
  finalWorkflowLabel: z.string().optional(), archiveReason: z.enum(ISSUE_ARCHIVE_REASON),
  closedAt: z.string().nullable().optional(), providerDeletedAt: z.string().nullable().optional(),
  archivedAt: z.string(), lastIntegrityStatus: z.enum(ISSUE_INTEGRITY_STATUS),
  attachmentDisposition: z.enum(ATTACHMENT_DISPOSITION), sourceSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

/** Strict schema for the current archived issue-store envelope. */
const IssueArchiveStoreSchema = z.object({
  projectSlug: z.string(), issues: z.record(z.string(), ArchivedIssueSchema),
}).strict();

/**
 * Parse archived state and enforce its owning project slug.
 *
 * @param value - Untrusted JSON-compatible archive value.
 * @param projectSlug - Project expected to own the archive.
 */
export function parseIssueArchiveStore(value: unknown, projectSlug: string): IssueArchiveStore {
  const store = IssueArchiveStoreSchema.parse(value);

  if (store.projectSlug !== projectSlug) {
    throw new Error(`Issue archive projectSlug mismatch: expected ${projectSlug}, got ${store.projectSlug}`);
  }

  for (const [archiveKey, record] of Object.entries(store.issues)) {
    if (record.projectSlug !== projectSlug) {
      throw new Error(`Archived issue #${record.issueId} projectSlug mismatch: expected ${projectSlug}, got ${record.projectSlug}`);
    }

    const expectedKey = issueArchiveKey(record);

    if (archiveKey !== expectedKey) {
      throw new Error(`Issue archive key mismatch: expected ${expectedKey}, got ${archiveKey}`);
    }
  }

  return store;
}
