import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createPluginContext } from "./lib/context.js";
import { toolRegistry } from "./lib/tools/registry.js";

// Infrastructure
import { registerCli } from "./lib/setup/cli.js";
import { registerHeartbeatService } from "./lib/application/heartbeat/index.js";
import { registerBootstrapHook } from "./lib/integrations/openclaw/bootstrap-hook.js";
import { registerAttachmentHook } from "./lib/application/tasks/attachment-hook.js";

const plugin = {
  id: "devclaw",
  name: "DevClaw",
  description:
    "Multi-project dev/qa pipeline orchestration with GitHub/GitLab integration, developer tiers, and audit logging.",
  configSchema: {
    type: "object",
    properties: {
      projectExecution: {
        type: "string",
        enum: ["parallel", "sequential"],
        description:
          "Plugin-level: parallel (each project independent) or sequential (one project at a time)",
        default: "parallel",
      },
      notifications: {
        type: "object",
        description:
          "Per-event-type notification toggles. All default to true — set to false to suppress.",
        properties: {
          workerStart: { type: "boolean", default: true },
          workerComplete: { type: "boolean", default: true },
        },
      },
      work_heartbeat: {
        type: "object",
        description:
          "Token-free interval-based heartbeat service. Runs health checks + queue dispatch automatically. Discovers all DevClaw agents from openclaw.json and processes each independently.",
        properties: {
          enabled: {
            type: "boolean",
            default: true,
            description: "Enable automatic periodic heartbeat service.",
          },
          intervalSeconds: {
            type: "number",
            default: 60,
            description: "Seconds between automatic heartbeat ticks.",
          },
          maxPickupsPerTick: {
            type: "number",
            default: 4,
            description: "Max worker dispatches per agent per tick. Applied to each DevClaw agent independently.",
          },
        },
      },
    },
  },

  register(api: OpenClawPluginApi) {
    const ctx = createPluginContext(api);

    for (const entry of toolRegistry) {
      api.registerTool(entry.factory(ctx), { names: [...entry.names] });
    }

    // CLI, services & hooks
    api.registerCli(({ program }: { program: any }) => registerCli(program, ctx), {
      commands: ["devclaw"],
      descriptors: [
        {
          name: "devclaw",
          description: "DevClaw development pipeline tools",
          hasSubcommands: true,
        },
      ],
    });
    registerHeartbeatService(api, ctx);
    registerBootstrapHook(api, ctx);
    registerAttachmentHook(api, ctx);

    api.logger.info(
      `DevClaw plugin registered (${toolRegistry.length} tools, 1 CLI command group, 1 service, 3 hooks)`,
    );
  },
};

export default plugin;
