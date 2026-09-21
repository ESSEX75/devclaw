/**
 * Owns the project-scoped lock shared by active and archived issue-store transactions.
 */
import path from "node:path";

import { DATA_DIR, PROJECTS_DIRECTORY_NAME } from "../../paths.js";
import { LOCK_FILE_SUFFIX, withFileLock } from "../../persistence/index.js";
import { parseProjectSlug } from "../../projects/schema.js";
import { ACTIVE_ISSUES_FILE_NAME, ISSUE_STORE_LOCK_OPTIONS } from "../const.js";

/**
 * Run an active/archive transaction under their shared project lock.
 *
 * @param workspaceDir - Workspace containing project-local issue state.
 * @param projectSlug - Canonical project whose active and archive stores are locked.
 * @param operation - State-owned transaction executed with exclusive store access.
 */
export async function withIssueStoreLock<T>(
  workspaceDir: string,
  projectSlug: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = path.join(
    workspaceDir,
    DATA_DIR,
    PROJECTS_DIRECTORY_NAME,
    parseProjectSlug(projectSlug),
    `${ACTIVE_ISSUES_FILE_NAME}${LOCK_FILE_SUFFIX}`,
  );

  return withFileLock(lockPath, ISSUE_STORE_LOCK_OPTIONS, operation);
}
