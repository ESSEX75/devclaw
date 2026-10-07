/** Validates mutable bootstrap input without cloning SDK-owned instruction resources. */

import type { WorkerBootstrapContext, WorkerBootstrapFile } from "./types.js";

/** Validate the instruction resource fields that this adapter reads and changes.
 * @param value - Untrusted SDK bootstrap resource.
 */
function isWorkerBootstrapFile(value: unknown): value is WorkerBootstrapFile {
  return typeof value === "object" && value !== null
    && "name" in value && typeof value.name === "string"
    && "path" in value && typeof value.path === "string"
    && "missing" in value && typeof value.missing === "boolean"
    && (!("content" in value) || value.content === undefined || typeof value.content === "string");
}

/** Validate workspace and resources while preserving references to the SDK event.
 * @param value - Untrusted SDK bootstrap context.
 */
export function isWorkerBootstrapContext(value: unknown): value is WorkerBootstrapContext {
  return typeof value === "object" && value !== null
    && "workspaceDir" in value && typeof value.workspaceDir === "string" && value.workspaceDir.trim().length > 0
    && "bootstrapFiles" in value && Array.isArray(value.bootstrapFiles) && value.bootstrapFiles.every(isWorkerBootstrapFile);
}
