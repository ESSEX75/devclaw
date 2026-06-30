import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../context.js";

// Worker lifecycle
import { createTaskStartTool } from "./tasks/task-start.js";
import { createWorkFinishTool } from "./worker/work-finish.js";

// Task management
import { createTaskCreateTool } from "./tasks/task-create.js";
import { createTaskEditBodyTool } from "./tasks/task-edit-body.js";
import { createTaskCommentTool } from "./tasks/task-comment.js";
import { createTaskAttachTool } from "./tasks/task-attach.js";
import { createTaskSetLevelTool } from "./tasks/task-set-level.js";
import { createTaskOwnerTool } from "./tasks/task-owner.js";
import { createResearchTaskTool } from "./tasks/research-task.js";
import { createIssueRepairTool } from "./issues/issue-repair.js";
import { createIssuesCleanupTool } from "./issues/issues-cleanup.js";

// Task queries
import { createTaskListTool } from "./tasks/task-list.js";
import { createTasksStatusTool } from "./tasks/tasks-status.js";

// Project admin
import { createProjectStatusTool } from "./admin/project-status.js";
import { createProjectRegisterTool } from "./admin/project-register.js";
import { createHealthTool } from "./admin/health.js";
import { createSyncLabelsTool } from "./admin/sync-labels.js";
import { createChannelLinkTool } from "./admin/channel-link.js";
import { createChannelUnlinkTool } from "./admin/channel-unlink.js";
import { createChannelListTool } from "./admin/channel-list.js";

// Setup & onboarding
import { createSetupTool } from "./admin/setup.js";
import { createOnboardTool } from "./admin/onboard.js";
import { createAutoConfigureModelsTool } from "./admin/autoconfigure-models.js";
import { createWorkflowGuideTool } from "./admin/workflow-guide.js";
import { createConfigTool } from "./admin/config.js";

type ToolInstanceFactory = (toolCtx: OpenClawPluginToolContext) => unknown;

export type ToolRegistryEntry = {
  readonly names: readonly [string, ...string[]];
  readonly factory: (ctx: PluginContext) => ToolInstanceFactory;
};

export const toolRegistry = [
  // Worker lifecycle
  { names: ["task_start"], factory: createTaskStartTool },
  { names: ["work_finish"], factory: createWorkFinishTool },

  // Task management
  { names: ["task_create"], factory: createTaskCreateTool },
  { names: ["task_edit_body"], factory: createTaskEditBodyTool },
  { names: ["task_comment"], factory: createTaskCommentTool },
  { names: ["task_attach"], factory: createTaskAttachTool },
  { names: ["task_set_level"], factory: createTaskSetLevelTool },
  { names: ["task_owner"], factory: createTaskOwnerTool },
  { names: ["research_task"], factory: createResearchTaskTool },
  { names: ["issue_repair"], factory: createIssueRepairTool },
  { names: ["issues_cleanup"], factory: createIssuesCleanupTool },

  // Task queries
  { names: ["task_list"], factory: createTaskListTool },
  { names: ["tasks_status"], factory: createTasksStatusTool },

  // Project admin
  { names: ["project_status"], factory: createProjectStatusTool },
  { names: ["project_register"], factory: createProjectRegisterTool },
  { names: ["health"], factory: createHealthTool },
  { names: ["sync_labels"], factory: createSyncLabelsTool },
  { names: ["channel_link"], factory: createChannelLinkTool },
  { names: ["channel_unlink"], factory: createChannelUnlinkTool },
  { names: ["channel_list"], factory: createChannelListTool },

  // Setup & onboarding
  { names: ["setup"], factory: createSetupTool },
  { names: ["onboard"], factory: createOnboardTool },
  { names: ["autoconfigure_models"], factory: createAutoConfigureModelsTool },
  { names: ["workflow_guide"], factory: createWorkflowGuideTool },
  { names: ["config"], factory: createConfigTool },
] as const satisfies readonly ToolRegistryEntry[];

