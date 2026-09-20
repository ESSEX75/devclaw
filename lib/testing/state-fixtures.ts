/**
 * Seeds validated DevClaw stores through their locked public update boundaries for tests.
 */
import type { IssueArchiveStore, IssueStateStore } from "../state/index.js";
import { updateIssueArchiveStore, updateIssueStateStore } from "../state/index.js";

/**
 * Build an empty active issue store for one test project.
 *
 * @param projectSlug - Canonical project that owns the fixture.
 */
export function createEmptyIssueStateStoreForTesting(projectSlug: string): IssueStateStore {
  return { projectSlug, issues: {} };
}

/**
 * Replace active issue state through the same locked boundary used by production mutations.
 *
 * @param workspaceDir - Isolated test workspace containing state fixtures.
 * @param projectSlug - Canonical project that owns the fixture.
 * @param store - Complete active issue store used by the test.
 */
export async function replaceIssueStateStoreForTesting(
  workspaceDir: string,
  projectSlug: string,
  store: IssueStateStore,
): Promise<void> {
  await updateIssueStateStore(workspaceDir, projectSlug, () => ({ store, result: undefined }));
}

/**
 * Replace archived issue state through the same locked boundary used by production mutations.
 *
 * @param workspaceDir - Isolated test workspace containing state fixtures.
 * @param projectSlug - Canonical project that owns the fixture.
 * @param store - Complete archive store used by the test.
 */
export async function replaceIssueArchiveStoreForTesting(
  workspaceDir: string,
  projectSlug: string,
  store: IssueArchiveStore,
): Promise<void> {
  await updateIssueArchiveStore(workspaceDir, projectSlug, () => ({ store, result: undefined }));
}
