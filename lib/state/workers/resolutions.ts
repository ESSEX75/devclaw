/** Persists operator evidence independently of slots so partial releases remain recoverable. */

import fs from "node:fs/promises";
import path from "node:path";

import { withIssueStoreLock } from "../issues/persistence/index.js";
import { DATA_DIR, PROJECTS_DIRECTORY_NAME } from "../paths.js";
import { isErrnoException, writeJsonAtomic } from "../persistence/index.js";
import { parseProjectSlug } from "../projects/schema.js";
import { WORKER_RESOLUTIONS_FILE_NAME } from "./const.js";
import { WorkerResolutionSchema, WorkerResolutionStoreSchema } from "./schema.js";
import type { WorkerDeliveryResolution } from "./types.js";

/** Address a project's recovery records using the validated canonical slug.
 * @param workspaceDir - Workspace root.
 * @param projectSlug - Owning project identity.
 */
function resolutionPath(workspaceDir: string, projectSlug: string): string {
  return path.join(workspaceDir, DATA_DIR, PROJECTS_DIRECTORY_NAME, parseProjectSlug(projectSlug), WORKER_RESOLUTIONS_FILE_NAME);
}

/** Read strict records; only a missing file represents an empty store.
 * @param workspaceDir - Workspace root.
 * @param projectSlug - Owning project identity.
 */
async function readResolutions(workspaceDir: string, projectSlug: string): Promise<Record<string, WorkerDeliveryResolution>> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(resolutionPath(workspaceDir, projectSlug), "utf8"));
    const records = WorkerResolutionStoreSchema.parse(value);

    for (const [key, record] of Object.entries(records)) {
      if (key !== String(record.issueId)) throw new Error("Worker resolution issue identity mismatch.");
    }

    return records;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return {};
    throw error;
  }
}

/** Read the latest decision without initializing or changing any state.
 * @param workspaceDir - Workspace containing recovery evidence.
 * @param projectSlug - Owning project.
 * @param issueId - Provider-local issue.
 */
export async function readWorkerDeliveryResolution(workspaceDir: string, projectSlug: string, issueId: number): Promise<WorkerDeliveryResolution | undefined> {
  return (await readResolutions(workspaceDir, projectSlug))[String(issueId)];
}

/** Record an immutable intent or mark the same decision complete under the project store lock.
 * @param workspaceDir - Workspace containing recovery evidence.
 * @param projectSlug - Owning project.
 * @param record - Validated evidence captured before effects, or its completed form.
 */
export async function writeWorkerDeliveryResolution(workspaceDir: string, projectSlug: string, record: WorkerDeliveryResolution): Promise<void> {
  await withIssueStoreLock(workspaceDir, projectSlug, async () => {
    const records = await readResolutions(workspaceDir, projectSlug);
    const previous = records[String(record.issueId)];
    const parsed = WorkerResolutionSchema.parse(record);

    if (previous && !previous.completed && previous.deliveryId !== parsed.deliveryId) {
      throw new Error("An unfinished worker delivery decision must be resumed first.");
    }

    if (previous?.deliveryId === parsed.deliveryId) {
      if (JSON.stringify({ ...previous, completed: false }) !== JSON.stringify({ ...parsed, completed: false })) {
        throw new Error("A recorded worker delivery decision cannot be changed.");
      }

      if (previous.completed && !parsed.completed) throw new Error("A completed decision cannot become pending again.");
    }

    records[String(parsed.issueId)] = parsed;
    await writeJsonAtomic(resolutionPath(workspaceDir, projectSlug), records);
  });
}
