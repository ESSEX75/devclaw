import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import type { RunCommand } from "../../context.js";
import { getRoleWorker, resolveRepoPath } from "../../state/projects/index.js";
import { executeCompletion, getRule } from "../pipeline/completion.js";
import { log as auditLog } from "../../audit.js";
import { DATA_DIR } from "../../state/setup/migrate-layout.js";
import { resolveProject, resolveProvider } from "../../tools/helpers.js";
import { getCompletionResults, isValidResult } from "../../roles/index.js";
import { loadConfig } from "../../state/config/index.js";

export type FinishWorkInput = {
  workspaceDir: string;
  channelId: string;
  role: string;
  result: string;
  summary?: string;
  prUrl?: string;
  createdTasks?: Array<{ id: number; title: string; url: string }>;
  sessionKey?: string;
  runCommand: RunCommand;
  runtime?: PluginRuntime;
  pluginConfig?: Record<string, unknown>;
};

async function getCurrentBranch(repoPath: string, runCommand: RunCommand): Promise<string> {
  const result = await runCommand(["git", "branch", "--show-current"], {
    timeoutMs: 5_000,
    cwd: repoPath,
  });
  return result.stdout.trim();
}

export async function isConflictResolutionCycle(
  workspaceDir: string,
  issueId: number,
): Promise<boolean> {
  const auditPath = join(workspaceDir, DATA_DIR, "log", "audit.log");
  try {
    const content = await readFile(auditPath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]!);
        if (
          entry.issueId === issueId &&
          entry.event === "review_transition" &&
          entry.reason === "merge_conflict"
        ) {
          return true;
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // If we can't read the audit log, fail open.
  }
  return false;
}

async function validatePrExistsForDeveloper(
  issueId: number,
  repoPath: string,
  provider: Awaited<ReturnType<typeof resolveProvider>>["provider"],
  runCommand: RunCommand,
  workspaceDir: string,
  projectSlug: string,
): Promise<void> {
  try {
    const prStatus = await provider.getPrStatus(issueId);

    if (!prStatus.url) {
      let branchName = "current-branch";
      try {
        branchName = await getCurrentBranch(repoPath, runCommand);
      } catch {
        // Fall back to generic placeholder.
      }

      throw new Error(
        `Cannot mark work_finish(done) without an open PR.\n\n` +
        `✗ No PR found for branch: ${branchName}\n\n` +
        `Please create a PR first:\n` +
        `  gh pr create --base main --head ${branchName} --title "..." --body "..."\n\n` +
        `Then call work_finish again.`,
      );
    }

    try {
      const hasEyes = await provider.prHasReaction(issueId, "eyes");
      if (!hasEyes) {
        await provider.reactToPr(issueId, "eyes");
      }
    } catch {
      // Cosmetic marker only.
    }

    const isConflictCycle = await isConflictResolutionCycle(workspaceDir, issueId);

    if (isConflictCycle && prStatus.mergeable === false) {
      await auditLog(workspaceDir, "work_finish_rejected", {
        project: projectSlug,
        issue: issueId,
        reason: "pr_still_conflicting",
        prUrl: prStatus.url,
      });

      const branchName = prStatus.sourceBranch || "your-branch";
      throw new Error(
        `Cannot complete work_finish(done) while PR still shows merge conflicts.\n\n` +
        `✗ PR status: CONFLICTING\n` +
        `✗ PR URL: ${prStatus.url}\n` +
        `✗ Branch: ${branchName}\n\n` +
        `Your local rebase may have succeeded, but changes must be pushed to the remote.\n\n` +
        `Verify your changes were pushed:\n` +
        `  git log origin/${branchName}..HEAD\n` +
        `  # Should show no commits (meaning everything is pushed)\n\n` +
        `If unpushed commits exist, push them:\n` +
        `  git push --force-with-lease origin ${branchName}\n\n` +
        `Wait a few seconds for GitHub to update, then verify the PR:\n` +
        `  gh pr view ${issueId}\n` +
        `  # Should show "Mergeable" status\n\n` +
        `Once the PR shows as mergeable on GitHub, call work_finish again.`,
      );
    }

    if (isConflictCycle) {
      await auditLog(workspaceDir, "conflict_resolution_verified", {
        project: projectSlug,
        issue: issueId,
        prUrl: prStatus.url,
        mergeable: prStatus.mergeable,
      });
    }
  } catch (err) {
    if (err instanceof Error && (err.message.startsWith("Cannot mark work_finish(done)") || err.message.startsWith("Cannot complete work_finish(done)"))) {
      throw err;
    }
    console.warn(`PR validation warning for issue #${issueId}:`, err);
  }
}

export async function finishWork(input: FinishWorkInput) {
  const {
    workspaceDir,
    channelId,
    role,
    result,
    summary,
    prUrl,
    createdTasks,
    runCommand,
    pluginConfig,
    runtime,
  } = input;

  if (!isValidResult(role, result)) {
    const valid = getCompletionResults(role);
    throw new Error(`${role.toUpperCase()} cannot complete with "${result}". Valid results: ${valid.join(", ")}`);
  }

  const { project } = await resolveProject(workspaceDir, channelId);
  const roleWorker = getRoleWorker(project, role);

  let slotIndex: number | null = null;
  let slotLevel: string | null = null;
  let issueId: number | null = null;

  for (const [level, slots] of Object.entries(roleWorker.levels)) {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i]!.active && slots[i]!.issueId &&
          (!input.sessionKey || !slots[i]!.sessionKey ||
           slots[i]!.sessionKey === input.sessionKey)) {
        slotLevel = level;
        slotIndex = i;
        issueId = Number(slots[i]!.issueId);
        break;
      }
    }
    if (issueId !== null) break;
  }

  if (slotIndex === null || slotLevel === null || issueId === null) {
    throw new Error(`${role.toUpperCase()} worker not active on ${project.name}`);
  }

  const { provider } = await resolveProvider(project, runCommand);
  const workflow = (await loadConfig(workspaceDir, project.name)).workflow;

  if (!getRule(role, result, workflow)) {
    throw new Error(`Invalid completion: ${role}:${result}`);
  }

  const repoPath = resolveRepoPath(project.repo);

  if (role === "developer" && result === "done") {
    await validatePrExistsForDeveloper(issueId, repoPath, provider, runCommand, workspaceDir, project.slug);
  }

  const completion = await executeCompletion({
    workspaceDir, projectSlug: project.slug, role, result, issueId, summary, prUrl, provider, repoPath,
    projectName: project.name,
    channels: project.channels,
    pluginConfig,
    level: slotLevel,
    slotIndex,
    runtime,
    workflow,
    createdTasks,
    runCommand,
  });

  await auditLog(workspaceDir, "work_finish", {
    project: project.name, issue: issueId, role, result,
    summary: summary ?? null, labelTransition: completion.labelTransition,
  });

  return {
    success: true, project: project.name, projectSlug: project.slug, issueId, role, result,
    ...completion,
  };
}
