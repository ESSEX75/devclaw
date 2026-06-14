/**
 * project_register — Register a new project with DevClaw.
 *
 * Atomically: validates repo, detects GitHub/GitLab provider, creates all 8 state labels (idempotent),
 * adds project entry to projects.json, and logs the event.
 *
 * Replaces the manual steps of running glab/gh label create + editing projects.json.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../../context.js";
import fs from "node:fs/promises";
import path from "node:path";
import { readProjects, writeProjects, emptyRoleWorkerState } from "../../projects/index.js";
import { resolveRepoPath } from "../../projects/index.js";
import { createProvider } from "../../providers/index.js";
import { log as auditLog } from "../../audit.js";
import { getAllRoleIds, getLevelsForRole } from "../../roles/index.js";
import { getLabelColors, getRoleLabels, getStateLabels } from "../../workflow/index.js";
import { loadConfig } from "../../config/index.js";
import { DATA_DIR } from "../../setup/migrate-layout.js";
import {
  checkSprintReinitReadiness,
  runSprintReadinessWritePhase,
  sprintModeEnabled,
} from "../../setup/sprint-readiness.js";

/**
 * Scaffold project directory with prompts/ folder and a README explaining overrides.
 * Returns true if files were created, false if they already existed.
 */
async function scaffoldPromptFiles(workspaceDir: string, projectName: string): Promise<boolean> {
  const projectDir = path.join(workspaceDir, DATA_DIR, "projects", projectName);
  const promptsDir = path.join(projectDir, "prompts");
  await fs.mkdir(promptsDir, { recursive: true });

  const readmePath = path.join(projectDir, "README.md");
  try {
    await fs.access(readmePath);
    return false;
  } catch {
    const roles = getAllRoleIds().join(", ");
    await fs.writeFile(readmePath, `# Project Overrides

This directory holds project-specific configuration that overrides the workspace defaults.

## Prompt Overrides

To override default worker instructions, create \`prompts/<role>.md\`:

Available roles: ${roles}

Example: \`prompts/developer.md\` overrides the default developer instructions for this project only.
Files here take priority over the workspace defaults in \`devclaw/prompts/\`.

## Workflow Overrides

To override the default workflow configuration, create \`workflow.yaml\` in this directory.

Only include the keys you want to override — everything else inherits from the workspace-level \`devclaw/workflow.yaml\`. The three-layer system is:

1. **Built-in defaults** (code)
2. **Workspace** — \`devclaw/workflow.yaml\`
3. **Project** — \`devclaw/projects/${projectName}/workflow.yaml\` (this directory)

Example — use a different review policy for this project:

\`\`\`yaml
workflow:
  reviewPolicy: agent
\`\`\`

Example — override model for senior developer:

\`\`\`yaml
roles:
  developer:
    models:
      senior: claude-sonnet-4-5-20250514
\`\`\`

Call \`workflow_guide\` for the full config reference.
`, "utf-8");
    return true;
  }
}

export function createProjectRegisterTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "project_register",
    label: "Project Register",
    description: `Register a new project with DevClaw. Creates state labels, adds to projects.json. One-time setup per project.`,
    parameters: {
      type: "object",
      required: ["channelId", "name", "repo", "baseBranch"],
      properties: {
        channelId: {
          type: "string",
          description: "Channel ID — the chat/group ID where this project is managed (e.g. Telegram group ID)",
        },
        name: {
          type: "string",
          description: "Short project name (e.g. 'my-webapp')",
        },
        repo: {
          type: "string",
          description: "Path to git repo (e.g. '~/git/my-project')",
        },
        channel: {
          type: "string",
          description: "Channel type (e.g. 'telegram', 'whatsapp'). Defaults to 'telegram'.",
        },
        threadId: {
          type: "string",
          description:
            "Optional thread/topic ID for forum-style channels, e.g. Telegram topic ID.",
        },
        groupName: {
          type: "string",
          description: "Group display name (optional - defaults to 'Project: {name}')",
        },
        baseBranch: {
          type: "string",
          description: "Base branch for development (e.g. 'development', 'main')",
        },
        deployBranch: {
          type: "string",
          description: "Branch that triggers deployment. Defaults to baseBranch.",
        },
        deployUrl: {
          type: "string",
          description: "Deployment URL for the project",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const channelId = params.channelId as string;
      const name = params.name as string;
      const repo = params.repo as string;
      const channel = (params.channel as string) ?? "telegram";
      const threadId = typeof params.threadId === "string" && params.threadId.trim()
        ? params.threadId.trim()
        : undefined;
      const groupName = (params.groupName as string) ?? `Project: ${name}`;
      const baseBranch = params.baseBranch as string;
      const deployBranch = (params.deployBranch as string) ?? baseBranch;
      const deployUrl = (params.deployUrl as string) ?? "";
      const workspaceDir = toolCtx.workspaceDir;

      if (!workspaceDir) {
        throw new Error("No workspace directory available in tool context");
      }

      // Generate slug from project name
      const slug = name.toLowerCase().replace(/\s+/g, "-");

      // 1. Check project exists or can be created
      const data = await readProjects(workspaceDir);
      const existing = data.projects[slug];

      // If project exists, check if this channelId is already registered
      if (existing) {
        const channelExists = existing.channels.some(ch => ch.channelId === channelId && ch.threadId === threadId);
        if (channelExists) {
          throw new Error(
            `Channel ${channelId}${threadId ? ` thread ${threadId}` : ""} is already registered for project "${name}". Each channel/thread can only register once per project.`,
          );
        }
        // Adding a new channel to an existing project
      }

      // 2. Resolve repo path
      const repoPath = resolveRepoPath(repo);

      const resolvedConfig = await loadConfig(workspaceDir, name);

      // 3. Create provider and verify it works
      const { provider, type: providerType } = await createProvider({ repo, runCommand: ctx.runCommand });

      const sprintReadiness = await checkSprintReinitReadiness({
        provider,
        project: { baseBranch },
        config: resolvedConfig,
      });
      if (sprintReadiness.state !== "ready") {
        await auditLog(workspaceDir, "project_register_sprint_reinit_failed", {
          project: name,
          projectSlug: slug,
          blocking: sprintReadiness.blocking,
          warnings: sprintReadiness.warnings,
        });
        return jsonResult({
          success: false,
          project: name,
          projectSlug: slug,
          reinit: sprintReadiness,
          message: "Sprint mode readiness failed before provider writes. No labels, milestones, branches, or issues were created.",
        });
      }
      if (!sprintModeEnabled(resolvedConfig)) {
        const healthy = await provider.healthCheck();
        if (!healthy) {
          const cliName = providerType === "github" ? "gh" : "glab";
          const cliInstallUrl = providerType === "github"
            ? "https://cli.github.com"
            : "https://gitlab.com/gitlab-org/cli";
          throw new Error(
            `${providerType.toUpperCase()} health check failed for ${repoPath}. ` +
            `Detected provider: ${providerType}. ` +
            `Ensure '${cliName}' CLI is installed, authenticated (${cliName} auth status), ` +
            `and the repo has a ${providerType.toUpperCase()} remote. ` +
            `Install ${cliName} from: ${cliInstallUrl}`,
          );
        }
      }

      // 4. Create labels only after sprint readiness checks pass.
      const stateLabels = getStateLabels(resolvedConfig.workflow);
      const labelColors = getLabelColors(resolvedConfig.workflow);
      const roleLabels = getRoleLabels(resolvedConfig.roles);
      const writeResult = await runSprintReadinessWritePhase({
        readiness: sprintReadiness,
        write: async (recordCreated) => {
          for (const label of stateLabels) {
            await provider.ensureLabel(label, labelColors[label]);
            if (sprintModeEnabled(resolvedConfig)) recordCreated({ type: "label", id: label });
          }
          for (const { name: labelName, color } of roleLabels) {
            await provider.ensureLabel(labelName, color);
            if (sprintModeEnabled(resolvedConfig)) recordCreated({ type: "label", id: labelName });
          }
        },
      });
      if (writeResult.state === "reinit_partial") {
        await auditLog(workspaceDir, "project_register_sprint_reinit_partial", {
          project: name,
          projectSlug: slug,
          blocking: writeResult.blocking,
          warnings: writeResult.warnings,
          created: writeResult.created,
        });
        return jsonResult({
          success: false,
          project: name,
          projectSlug: slug,
          reinit: writeResult,
          message: "Sprint mode reinit reached partial state during provider writes. Run repair before creating sprints.",
        });
      }

      // 5. Auto-detect repoRemote from git
      let repoRemote: string | undefined;
      try {
        const result = await ctx.runCommand(["git", "remote", "get-url", "origin"], {
          timeoutMs: 5_000,
          cwd: repoPath,
        });
        repoRemote = result.stdout.trim() || undefined;
      } catch {
        repoRemote = undefined;
      }

      // 6. Add or update project in projects.json
      if (existing) {
        // Add channel to existing project
        const newChannel: import("../../projects/index.js").Channel = {
          channelId,
          channel: channel as "telegram" | "whatsapp" | "discord" | "slack",
          name: `channel-${existing.channels.length + 1}`,
          events: ["*"],
          ...(threadId ? { threadId } : {}),
        };
        existing.channels.push(newChannel);
        if (repoRemote && !existing.repoRemote) {
          existing.repoRemote = repoRemote;
        }
      } else {
        // Create new project - get levelMaxWorkers from resolved config (already loaded above)
        const workers: Record<string, import("../../projects/index.js").RoleWorkerState> = {};
        for (const role of getAllRoleIds()) {
          const levelMaxWorkers = resolvedConfig.roles[role]?.levelMaxWorkers ?? {};
          workers[role] = emptyRoleWorkerState(levelMaxWorkers);
        }

        const newChannel: import("../../projects/index.js").Channel = {
          channelId,
          channel: channel as "telegram" | "whatsapp" | "discord" | "slack",
          name: "primary",
          events: ["*"],
          ...(threadId ? { threadId } : {}),
        };

        data.projects[slug] = {
          slug,
          name,
          repo,
          repoRemote,
          groupName,
          deployUrl,
          baseBranch,
          deployBranch,
          channels: [newChannel],
          provider: providerType,
          workers,
        };
      }

      await writeProjects(workspaceDir, data);

      // 7. Scaffold prompt files
      const promptsCreated = await scaffoldPromptFiles(workspaceDir, name);

      // 8. Audit log
      await auditLog(workspaceDir, "project_register", {
        project: name,
        projectSlug: slug,
        channelId,
        threadId,
        repo,
        repoRemote: repoRemote || null,
        baseBranch,
        deployBranch,
        deployUrl: deployUrl || null,
        isNewProject: !existing,
      });

      // 9. Return announcement
      const promptsNote = promptsCreated ? " Prompt files scaffolded." : "";
      const action = existing ? `Channel added to existing project` : `Project "${name}" created`;
      const announcement = `${action}. Labels ensured.${promptsNote} Ready for tasks.`;

      // Active workflow info for the orchestrator to mention
      const activeWorkflow = {
        reviewPolicy: resolvedConfig.workflow.reviewPolicy ?? "human",
        testPhase: Object.values(resolvedConfig.workflow.states).some(
          (s) => s.role === "tester" && (s.type === "queue" || s.type === "active"),
        ),
        hint: "The user can change the review policy or enable the test phase — call workflow_guide for the full reference.",
      };

      return jsonResult({
        success: true,
        project: name,
        projectSlug: slug,
        channelId,
        threadId,
        repo,
        repoRemote: repoRemote || null,
        baseBranch,
        deployBranch,
        labelsCreated: 10,
        promptsScaffolded: promptsCreated,
        isNewProject: !existing,
        activeWorkflow,
        announcement,
      });
    },
  });
}
