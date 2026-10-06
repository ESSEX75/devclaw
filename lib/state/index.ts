/**
 * Exposes the supported persistence API for every consumer outside `lib/state`.
 * Internal state modules import their concrete owners directly to avoid barrel cycles.
 */

export * from "./attachments/index.js";
export * from "./config/index.js";
export * from "./issues/index.js";
export { DATA_DIR, PROJECTS_DIRECTORY_NAME } from "./paths.js";
export * from "./projects/index.js";
export * from "./setup/index.js";
export * from "./workers/index.js";
