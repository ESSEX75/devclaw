/** Exposes canonical project registry persistence and worker-slot operations to the state package. */
export { activateWorker, deactivateWorker, updateSlot } from "./mutations.js";
export { resolveRepoPath } from "./paths.js";
export { getProject, getRoleWorker } from "./queries.js";
export { readProjects, updateProjects } from "./repository.js";
export { parseNotificationEndpoint, parseProjectSlug } from "./schema.js";
export type { ProjectsData } from "./types.js";
