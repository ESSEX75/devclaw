/**
 * Provides pure project-registry lookups independent of filesystem persistence.
 */
import type { Project, RoleWorkerState } from "../../domain/index.js";
import type { ProjectsData } from "./types.js";

/**
 * Resolve a project slug from either its slug or notification channel identifier.
 *
 * @param data - Registry snapshot to query.
 * @param slugOrChannelId - Slug or provider channel identifier.
 */
export function resolveProjectSlug(data: ProjectsData, slugOrChannelId: string): string | undefined {
  if (data.projects[slugOrChannelId]) return slugOrChannelId;

  return Object.entries(data.projects).find(([, project]) => (
    project.channels.some((channel) => channel.channelId === slugOrChannelId)
  ))?.[0];
}

/**
 * Find a project by slug or notification channel identifier.
 *
 * @param data - Registry snapshot to query.
 * @param slugOrChannelId - Slug or provider channel identifier.
 */
export function getProject(data: ProjectsData, slugOrChannelId: string): Project | undefined {
  const slug = resolveProjectSlug(data, slugOrChannelId);

  return slug ? data.projects[slug] : undefined;
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
