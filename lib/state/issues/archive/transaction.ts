/**
 * Coordinates crash-safe transfers from active issue state into the archive.
 */
import type { ArchivedIssueRecord, IssueRuntimeState } from "../../../domain/index.js";
import {
  emptyIssueStateStore,
  readIssueStateStore,
  withIssueStoreLock,
  writeIssueStateStore,
} from "../active/repository.js";
import { emptyIssueArchiveStore, issueArchiveKey, readIssueArchiveStore, writeIssueArchiveStore } from "./repository.js";

/** Move one active issue into the archive using archive-first write order. */
export async function archiveIssueState(
  workspaceDir: string,
  projectSlug: string,
  issueId: number,
  buildRecord: (state: IssueRuntimeState) => ArchivedIssueRecord,
): Promise<ArchivedIssueRecord | null> {
  return withIssueStoreLock(workspaceDir, projectSlug, async () => {
    const active = await readIssueStateStore(workspaceDir, projectSlug);
    const archive = await readIssueArchiveStore(workspaceDir, projectSlug);
    const state = active.issues[String(issueId)];

    if (!state) return Object.values(archive.issues).find((record) => record.issueId === issueId) ?? null;
    const record = buildRecord(state);
    const key = issueArchiveKey(record);
    const nextArchive = { ...archive, issues: { ...archive.issues, [key]: archive.issues[key] ?? record } };

    await writeIssueArchiveStore(workspaceDir, projectSlug, nextArchive);
    const { [String(issueId)]: removed, ...remainingIssues } = active.issues;

    void removed;
    await writeIssueStateStore(workspaceDir, projectSlug, { ...active, issues: remainingIssues });

    return nextArchive.issues[key] ?? null;
  });
}

/** Replace both issue stores after an explicit operator reset. */
export async function resetIssueStores(workspaceDir: string, projectSlug: string): Promise<void> {
  await withIssueStoreLock(workspaceDir, projectSlug, async () => {
    await writeIssueArchiveStore(workspaceDir, projectSlug, emptyIssueArchiveStore(projectSlug));
    await writeIssueStateStore(workspaceDir, projectSlug, emptyIssueStateStore(projectSlug));
  });
}
