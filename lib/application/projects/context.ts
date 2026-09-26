/** Resolves persisted project routes and provider configuration for application use cases. */
import type { RunCommand } from "../../context.js";
import type { Project } from "../../domain/index.js";
import { createProvider, type ProviderWithType } from "../../integrations/providers/index.js";
import { loadConfig, type ProjectsData, readProjects } from "../../state/index.js";

/**
 * Resolve an unambiguous project from its persisted notification destination.
 * Rejects ambiguous channel identifiers instead of allowing state queries to guess a project.
 *
 * @param workspaceDir - Workspace containing the projects registry.
 * @param channelId - Provider channel identifier supplied by the tool caller.
 */
export async function resolveProject(
  workspaceDir: string,
  channelId: string,
): Promise<{ data: ProjectsData; project: Project }> {
  const data = await readProjects(workspaceDir);
  const matches = Object.values(data.projects).filter((project) => (
    project.channels.some((channel) => channel.channelId === channelId)
  ));

  if (matches.length > 1) {
    throw new Error(`Channel ID "${channelId}" is ambiguous across registered projects.`);
  }

  const project = matches[0];

  if (!project) {
    throw new Error(
      `No project found for "${channelId}". ` +
      `Register a new project with project_register, or link this channel to an existing project.`,
    );
  }

  return { data, project };
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
