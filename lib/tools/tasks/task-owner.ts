/**
 * task_owner — Claim issue(s) for this instance.
 *
 * Adds an `owner:{instanceName}` label to issues so this instance
 * owns them for queue scanning and dispatch. Supports claiming a
 * single issue or all unclaimed queued issues for a project.
 */
import { jsonResult, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";

import type { PluginContext } from "../../context.js";
import {
  getAllQueueLabels,
  getOwnerLabel,
  ISSUE_INTEGRITY_STATUS,
  OWNER_LABEL_COLOR,
  OWNER_LABEL_PREFIX,
} from "../../domain/index.js";
import { loadInstanceName } from "../../instance.js";
import { loadConfig } from "../../state/config/index.js";
import { readIssueStateStore, writeIssueRuntimeState } from "../../state/issues/index.js";
import { requireWorkspaceDir, resolveChannelId, resolveProject, resolveProvider } from "../helpers.js";

export function createTaskOwnerTool(ctx: PluginContext) {
  return (toolCtx: OpenClawPluginToolContext) => ({
    name: "task_owner",
    label: "Task Owner",
    description:
      "Claim issue(s) for this instance by adding an owner label. " +
      "If issueId is given, claims that specific issue. Otherwise claims all unclaimed queued issues. " +
      "Use force to transfer ownership from another instance.",
    parameters: {
      type: "object",
      required: ["channelId"],
      properties: {
        channelId: {
          type: "string",
          description: "YOUR chat/group ID — the numeric ID of the chat you are in right now (e.g. '-1003844794417'). Do NOT guess; use the ID of the conversation this message came from.",
        },
        issueId: {
          type: "number",
          description:
            "Specific issue ID to claim. If omitted, claims all unclaimed queued issues.",
        },
        force: {
          type: "boolean",
          description:
            "Override existing owner label (transfer ownership). Default: false.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const channelId = resolveChannelId(toolCtx, params.channelId as string | undefined);
      const issueIdParam = params.issueId as number | undefined;
      const force = (params.force as boolean) ?? false;
      const workspaceDir = requireWorkspaceDir(toolCtx);

      const { project } = await resolveProject(workspaceDir, channelId);
      const { provider, type: providerType } = await resolveProvider(project, ctx.runCommand);
      const resolvedConfig = await loadConfig(workspaceDir, project.name);
      const instanceName = await loadInstanceName(
        workspaceDir,
        resolvedConfig.instanceName,
      );
      const ownerLabel = getOwnerLabel(instanceName);

      // Ensure the owner label exists in the issue tracker
      await provider.ensureLabel(ownerLabel, OWNER_LABEL_COLOR);

      const claimed: number[] = [];
      const skipped: Array<{ issueId: number; reason: string }> = [];

      if (issueIdParam !== undefined) {
        // Claim a single issue
        const issue = await provider.getIssue(issueIdParam);
        const store = await readIssueStateStore(workspaceDir, project.slug);
        const currentOwner = store.issues[String(issueIdParam)]?.owner ?? null;

        if (currentOwner === instanceName) {
          skipped.push({ issueId: issueIdParam, reason: "Already owned by this instance" });
        } else if (currentOwner && !force) {
          skipped.push({
            issueId: issueIdParam,
            reason: `Owned by "${currentOwner}". Use force=true to transfer.`,
          });
        } else {
          // Remove old owner label if transferring
          if (currentOwner) {
            const oldLabel = getOwnerLabel(currentOwner);

            await provider.removeLabels(issueIdParam, [oldLabel]);
          }

          await provider.addLabel(issueIdParam, ownerLabel);
          await writeIssueRuntimeState({
            workspaceDir,
            project,
            issue: { ...issue, labels: issue.labels.filter((label) => !label.startsWith(OWNER_LABEL_PREFIX)).concat(ownerLabel) },
            providerType,
            workflow: resolvedConfig.workflow,
            owner: instanceName,
          });
          claimed.push(issueIdParam);
        }
      } else {
        // Claim all unclaimed queued issues
        const workflow = resolvedConfig.workflow;
        const queueLabels = getAllQueueLabels(workflow);
        const store = await readIssueStateStore(workspaceDir, project.slug);
        const candidateStates = Object.values(store.issues)
          .filter((state) =>
            state.managed
            && state.archivedAt == null
            && state.integrityStatus !== ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR
            && queueLabels.includes(state.workflowLabel),
          )
          .sort((a, b) => a.issueId - b.issueId);

        for (const state of candidateStates) {
          try {
            const currentOwner = state.owner ?? null;

            if (currentOwner === instanceName) continue; // already ours
            if (currentOwner && !force) {
              skipped.push({
                issueId: state.issueId,
                reason: `Owned by "${currentOwner}"`,
              });
              continue;
            }

            const issue = await provider.getIssue(state.issueId);

            if (issue.state === "closed" || issue.state === "CLOSED") continue;
            if (currentOwner) {
              const oldLabel = getOwnerLabel(currentOwner);

              await provider.removeLabels(issue.iid, [oldLabel]);
            }

            await provider.addLabel(issue.iid, ownerLabel);
            await writeIssueRuntimeState({
              workspaceDir,
              project,
              issue: { ...issue, labels: issue.labels.filter((label) => !label.startsWith(OWNER_LABEL_PREFIX)).concat(ownerLabel) },
              providerType,
              workflow,
              owner: instanceName,
            });
            claimed.push(issue.iid);
          } catch {
            skipped.push({ issueId: state.issueId, reason: "Provider fetch/update failed" });
          }
        }
      }

      return jsonResult({
        success: true,
        instanceName,
        ownerLabel,
        claimed,
        skipped,
        summary: `Claimed ${claimed.length} issue(s) for "${instanceName}"${skipped.length > 0 ? `, ${skipped.length} skipped` : ""}`,
      });
    },
  });
}
