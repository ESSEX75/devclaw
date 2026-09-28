/** Resolves persisted project routes and provider configuration for application use cases. */

import type { RunCommand } from "../../context.js";
import type { Project } from "../../domain/index.js";
import { createProvider, type ProviderWithType } from "../../integrations/providers/index.js";
import { loadConfig, type ProjectsData, readProjects } from "../../state/index.js";
import type { ProjectContext, ProjectRoute } from "./types.js";

/**
 * Resolve one persisted endpoint from a channel-only input.
 * Different accounts, transports, or topics sharing the same ID are ambiguous even within one project.
 *
 * @param workspaceDir - Workspace containing the projects registry.
 * @param channelId - Conversation identifier supplied without account or topic identity.
 */
export async function resolveProject(
  workspaceDir: string,
  channelId: string,
): Promise<ProjectContext> {
  const data = await readProjects(workspaceDir);
  const matches = Object.values(data.projects).flatMap(project => project.channels
    .filter(endpoint => endpoint.channelId === channelId)
    .map(endpoint => ({ data, project, endpoint })));

  if (matches.length > 1) {
    throw new Error(`Channel ID "${channelId}" is ambiguous across registered endpoints; provide channel, account and thread.`);
  }

  const context = matches[0];

  if (!context) {
    throw new Error(
      `No project found for "${channelId}". ` +
      `Register a new project with project_register, or link this channel to an existing project.`,
    );
  }

  return context;
}

/** Match one complete persisted destination within a validated registry snapshot.
 * Optional agent identity prevents a hook from consuming another agent's route.
 * @param data - Strict registry snapshot to inspect.
 * @param route - Complete channel, account, conversation and topic identity.
 * @param agentId - Optional configured owner whose projects may match.
 */
export function findProjectByRoute(data: ProjectsData, route: ProjectRoute, agentId?: string): ProjectContext | null {
  const matches = Object.values(data.projects).filter(project => !agentId || project.agentId === agentId)
    .flatMap(project => project.channels.filter(endpoint => endpoint.channel === route.channel
      && endpoint.accountId === route.accountId && endpoint.channelId === route.channelId
      && endpoint.threadId === route.threadId).map(endpoint => ({ data, project, endpoint })));

  if (matches.length > 1) throw new Error("Exact route is ambiguous across registered projects.");

  return matches[0] ?? null;
}

/** Resolve a complete route from the persisted registry, rejecting absence and ambiguity.
 * @param workspaceDir - Workspace containing the registry.
 * @param route - Complete conversation and topic identity.
 */
export async function resolveProjectByRoute(workspaceDir: string, route: ProjectRoute): Promise<ProjectContext> {
  const context = findProjectByRoute(await readProjects(workspaceDir), route);

  if (!context) throw new Error("Exact route does not resolve to a registered project endpoint.");

  return context;
}

/**
 * Create an issue provider for a project.
 * Uses the provider selected and persisted during project registration.
 * @param workspaceDir - Workspace holding the resolved workflow configuration.
 * @param project - Persisted project identity and provider selection.
 * @param runCommand - Integration command transport.
 */
export async function resolveProvider(
  workspaceDir: string,
  project: Project,
  runCommand: RunCommand,
): Promise<ProviderWithType> {
  const config = await loadConfig(workspaceDir, project.slug);

  return createProvider({
    repo: project.repo,
    provider: project.provider,
    runCommand,
    workflow: config.workflow,
  });
}
