/**
 * tool-helpers.ts — Shared resolution helpers for tool execute() functions.
 *
 * Eliminates repeated boilerplate across tools: workspace validation,
 * project resolution, provider creation.
 */
import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import type { RunCommand } from "../context.js";
import {
  type Project,
  type ProjectsData,
} from "../domain/index.js";
import { createProvider, type ProviderWithType } from "../integrations/providers/index.js";
import { loadConfig } from "../state/config/index.js";
import { getProject,readProjects } from "../state/projects/index.js";

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
 * Resolve project by channelId or project slug.
 * Throws with actionable guidance if not found.
 */
export async function resolveProject(
  workspaceDir: string,
  channelId: string,
): Promise<{ data: ProjectsData; project: Project }> {
  const data = await readProjects(workspaceDir);
  const project = getProject(data, channelId);

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
 * Uses stored provider type from project config if available, otherwise auto-detects.
 */
export async function resolveProvider(
  workspaceDir: string,
  project: Project,
  runCommand: RunCommand,
): Promise<ProviderWithType> {
  const config = await loadConfig(workspaceDir, project.name);

  return createProvider({
    repo: project.repo,
    provider: project.provider,
    runCommand,
    workflow: config.workflow,
  });
}
