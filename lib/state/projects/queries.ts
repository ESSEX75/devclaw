/**
 * Provides pure project-registry lookups independent of filesystem persistence.
 */
import type { Project, RoleWorkerState } from "../../domain/index.js";
import type { ProjectsData } from "./types.js";

/**
 * Find a project by its canonical registry slug.
 *
 * @param data - Registry snapshot to query.
 * @param projectSlug - Canonical project slug used as the registry key.
 */
export function getProject(data: ProjectsData, projectSlug: string): Project | undefined {
  return data.projects[projectSlug];
}

/**
 * Read one role's worker allocation from a project snapshot.
 *
 * @param project - Project whose workers are queried.
 * @param role - Configured role identifier.
 */
export function getRoleWorker(project: Project, role: string): RoleWorkerState {
  return project.workers[role] ?? { levels: {} };
}
