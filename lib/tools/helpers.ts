/**
 * tool-helpers.ts — Shared resolution helpers for tool execute() functions.
 *
 * Eliminates repeated boilerplate across tools: workspace validation,
 * project resolution, provider creation.
 */
import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import type { RunCommand } from "../context.js";
import type { Project } from "../domain/index.js";
import { createProvider, type ProviderWithType } from "../integrations/providers/index.js";
import { loadConfig } from "../state/index.js";
import { type ProjectsData, readProjects } from "../state/index.js";

/**
 * Require workspaceDir from context or throw a clear error.
 */
export function requireWorkspaceDir(ctx: OpenClawPluginToolContext): string {
  if (!ctx.workspaceDir) {
    throw new Error("No workspace directory available in tool context");
  }

  return ctx.workspaceDir;
}

/**
 * Resolve the channelId from explicit tool param.
 */
export function resolveChannelId(_ctx: OpenClawPluginToolContext, explicitChannelId?: string): string {
  if (!explicitChannelId) {
    throw new Error(
      "channelId is required. Pass YOUR chat/group ID (the numeric ID of the chat you are in right now).",
    );
  }

  return explicitChannelId;
}

/**
 * Resolve a project at the tool routing boundary from a notification channel identifier.
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
