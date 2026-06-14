/**
 * cli.ts — CLI registration for `openclaw devclaw setup`.
 *
 * Uses Commander.js (provided by OpenClaw plugin SDK context).
 */
import type { Command } from "commander";
import { createInterface } from "node:readline/promises";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../context.js";
import { runSetup } from "./index.js";
import {
  ensureRequiredOpenClawScopes,
  isScopeApprovalRejectedError,
  isScopeApprovalRequiredError,
} from "./scopes.js";
import { getAllDefaultModels, getAllRoleIds, getLevelsForRole } from "../roles/index.js";
import { ExecutionMode, type ExecutionMode as ExecutionModeType } from "../workflow/index.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { repairSprint, type SprintRepairSource } from "../tools/sprints/sprint-repair.js";

/**
 * Get the default workspace directory from the OpenClaw config.
 */
function getDefaultWorkspaceDir(runtime: PluginRuntime): string | undefined {
  try {
    const config = runtime.config.current() as OpenClawConfig;
    return config.agents?.defaults?.workspace ?? undefined;
  } catch {
    return undefined;
  }
}

type SetupCliOptions = {
  newAgent?: string;
  agent?: string;
  workspace?: string;
  channelBinding?: "telegram" | "whatsapp" | "none";
  channelAccountId?: string;
  channelPeerId?: string;
  migrateFrom?: string;
  ejectDefaults?: boolean;
  projectExecution?: ExecutionModeType;
  [key: string]: string | boolean | undefined;
};

type SprintRepairCliOptions = {
  workspace?: string;
  project?: string;
  rootIssue?: string;
  source?: SprintRepairSource;
};

type ConfiguredAgent = {
  id: string;
  name?: string;
  workspace?: string;
};

function getConfiguredAgents(runtime: PluginRuntime): ConfiguredAgent[] {
  try {
    const config = runtime.config.current() as OpenClawConfig;
    return config.agents?.list ?? [];
  } catch {
    return [];
  }
}

function formatAgentLabel(agent: ConfiguredAgent): string {
  return agent.name && agent.name !== agent.id ? `${agent.name} (${agent.id})` : agent.id;
}

function printSelectedSetupTarget(opts: SetupCliOptions, runtime: PluginRuntime): void {
  const agents = getConfiguredAgents(runtime);

  if (opts.agent) {
    const agent = agents.find((entry) => entry.id === opts.agent);
    console.log("\nSelected setup target:");
    console.log(`  Agent: ${agent ? formatAgentLabel(agent) : opts.agent}`);
    if (agent?.workspace) console.log(`  Workspace: ${agent.workspace}`);
    console.log(`  Channel binding: ${formatSelectedChannelBinding(opts)}`);
    return;
  }

  if (opts.newAgent) {
    console.log("\nSelected setup target:");
    console.log(`  New agent: ${opts.newAgent}`);
    console.log(`  Channel binding: ${formatSelectedChannelBinding(opts)}`);
    if (opts.migrateFrom) console.log(`  Migrate binding from: ${opts.migrateFrom}`);
    return;
  }

  if (opts.workspace) {
    console.log("\nSelected setup target:");
    console.log(`  Workspace: ${opts.workspace}`);
  }
}

function formatSelectedChannelBinding(opts: Pick<SetupCliOptions, "channelBinding" | "channelAccountId" | "channelPeerId">): string {
  if (!opts.channelBinding || opts.channelBinding === "none") return "none";
  const account = opts.channelAccountId?.trim() || "default";
  return opts.channelPeerId?.trim()
    ? `${opts.channelBinding}/${account}/${opts.channelPeerId.trim()}`
    : `${opts.channelBinding}/${account}`;
}

function getExistingChannelWideBinding(
  runtime: PluginRuntime,
  channel: "telegram" | "whatsapp",
  accountId?: string,
): { agentId: string; agentName: string } | undefined {
  try {
    const config = runtime.config.current() as OpenClawConfig;
    const normalizedAccountId = accountId?.trim() || "default";
    const binding = (config.bindings ?? []).find(
      (entry) =>
        entry.match?.channel === channel &&
        (entry.match.accountId?.trim() || "default") === normalizedAccountId &&
        !entry.match.peer,
    );
    if (!binding?.agentId) return undefined;
    const agent = config.agents?.list?.find((entry) => entry.id === binding.agentId);
    return { agentId: binding.agentId, agentName: agent?.name ?? binding.agentId };
  } catch {
    return undefined;
  }
}

type ChannelAccountChoice = {
  channel: "telegram" | "whatsapp";
  accountId: string;
  label: string;
  peerId?: string;
};

function getBoundTopicPeerIds(
  config: OpenClawConfig,
  channel: "telegram" | "whatsapp",
  accountId: string,
): Set<string> {
  const normalizedAccountId = accountId.trim() || "default";
  const peerIds = new Set<string>();

  for (const binding of config.bindings ?? []) {
    const peerId = binding.match?.peer?.id?.trim();
    if (
      binding.match?.channel === channel &&
      (binding.match.accountId?.trim() || "default") === normalizedAccountId &&
      peerId?.includes(":topic:")
    ) {
      peerIds.add(peerId);
    }
  }

  return peerIds;
}

function getConfiguredChannelAccounts(runtime: PluginRuntime): ChannelAccountChoice[] {
  try {
    const config = runtime.config.current() as OpenClawConfig;
    const choices: ChannelAccountChoice[] = [];
    for (const channel of ["telegram", "whatsapp"] as const) {
      const channelConfig = config.channels?.[channel];
      if (!channelConfig || channelConfig.enabled === false) continue;
      choices.push(...buildChannelEndpointChoices(
        channel,
        "default",
        channelConfig,
        getBoundTopicPeerIds(config, channel, "default"),
      ));
      const accounts = channelConfig.accounts;
      if (accounts && typeof accounts === "object" && !Array.isArray(accounts)) {
        for (const [accountId, accountConfig] of Object.entries(accounts)) {
          const normalized = accountId.trim();
          if (normalized && normalized !== "default") {
            choices.push(...buildChannelEndpointChoices(
              channel,
              normalized,
              accountConfig,
              getBoundTopicPeerIds(config, channel, normalized),
            ));
          }
        }
      }
    }
    return choices;
  } catch {
    return [];
  }
}

function buildChannelEndpointChoices(
  channel: "telegram" | "whatsapp",
  accountId: string,
  rawConfig: unknown,
  boundTopicPeerIds: Set<string>,
): ChannelAccountChoice[] {
  const choices: ChannelAccountChoice[] = [{
    channel,
    accountId,
    label: `${channel} / ${accountId} / all messages (fallback)`,
  }];
  const config = rawConfig as { groups?: Record<string, { topics?: Record<string, unknown> }> };
  const groups = config.groups;
  if (!groups || typeof groups !== "object" || Array.isArray(groups)) return choices;

  for (const [groupId, groupConfig] of Object.entries(groups)) {
    if (!groupId || groupId === "*") continue;
    choices.push({
      channel,
      accountId,
      peerId: groupId,
      label: `${channel} / ${accountId} / group ${groupId}`,
    });

    const topics = groupConfig?.topics;
    if (!topics || typeof topics !== "object" || Array.isArray(topics)) continue;
    for (const topicId of Object.keys(topics)) {
      if (!topicId || topicId === "*") continue;
      const peerId = `${groupId}:topic:${topicId}`;
      if (boundTopicPeerIds.has(peerId)) continue;
      choices.push({
        channel,
        accountId,
        peerId,
        label: `${channel} / ${accountId} / group ${groupId} / topic ${topicId}`,
      });
    }
  }

  return choices;
}

function normalizeChannelBinding(value: SetupCliOptions["channelBinding"]): "telegram" | "whatsapp" | null | undefined {
  if (value === undefined) return undefined;
  if (value === "none") return null;
  if (value === "telegram" || value === "whatsapp") return value;
  throw new Error(`Invalid channel binding: ${value}. Use telegram, whatsapp, or none.`);
}

function normalizeProjectExecution(value: SetupCliOptions["projectExecution"]): ExecutionModeType | undefined {
  if (value === undefined) return undefined;
  if (value === ExecutionMode.PARALLEL || value === ExecutionMode.SEQUENTIAL) return value;
  throw new Error(`Invalid project execution mode: ${value}. Use parallel or sequential.`);
}

async function askYesNo(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? " [Y/n]: " : " [y/N]: ";
  const answer = (await rl.question(question + suffix)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

async function collectChannelBinding(
  rl: ReturnType<typeof createInterface>,
  runtime: PluginRuntime,
  targetAgentId?: string,
): Promise<Pick<SetupCliOptions, "channelBinding" | "channelAccountId" | "channelPeerId" | "migrateFrom">> {
  const choices = getConfiguredChannelAccounts(runtime);
  console.log("\nCreate a binding for an existing channel endpoint:");
  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}. ${choice.label}`);
  });
  const noneIndex = choices.length + 1;
  console.log(`  ${noneIndex}. none`);

  const defaultIndex = choices.length > 0 ? 1 : noneIndex;
  const answer = (await rl.question(`Select [${defaultIndex}]: `)).trim();
  const selected = answer ? Number(answer) : defaultIndex;
  if (selected === noneIndex) return { channelBinding: "none" };
  const choice = Number.isInteger(selected) ? choices[selected - 1] : undefined;
  if (!choice) throw new Error(`Invalid channel account option: ${answer}`);

  const channelBinding = choice.channel;
  const channelAccountId = choice.accountId;
  const channelPeerId = choice.peerId;
  const result: Pick<SetupCliOptions, "channelBinding" | "channelAccountId" | "channelPeerId" | "migrateFrom"> = {
    channelBinding,
    channelAccountId,
    channelPeerId,
  };

  if (channelPeerId) return result;

  const existing = getExistingChannelWideBinding(
    runtime,
    channelBinding,
    channelAccountId,
  );
  if (!existing) return result;
  if (targetAgentId && existing.agentId === targetAgentId) return result;

  console.log(`Existing ${channelBinding} channel-wide binding: ${existing.agentName} (${existing.agentId})`);
  const migrate = await askYesNo(rl, `Migrate this binding to the selected agent`, true);
  return migrate ? { ...result, migrateFrom: existing.agentId } : result;
}

function hasModelOverrides(opts: SetupCliOptions): boolean {
  for (const role of getAllRoleIds()) {
    for (const level of getLevelsForRole(role)) {
      const key = `${role}${level.charAt(0).toUpperCase()}${level.slice(1)}`;
      if (opts[key]) return true;
    }
  }
  return false;
}

async function collectModelOptions(
  opts: SetupCliOptions,
  rl: ReturnType<typeof createInterface>,
): Promise<SetupCliOptions> {
  if (hasModelOverrides(opts)) return opts;

  const useDefaults = await askYesNo(rl, "\nUse default model levels", true);
  if (useDefaults) return opts;

  const defaults = getAllDefaultModels();
  const next = { ...opts };
  for (const role of getAllRoleIds()) {
    for (const level of getLevelsForRole(role)) {
      const key = `${role}${level.charAt(0).toUpperCase()}${level.slice(1)}`;
      const defaultModel = defaults[role]?.[level] ?? "";
      const answer = (await rl.question(`${role}.${level} model [${defaultModel}]: `)).trim();
      if (answer) next[key] = answer;
    }
  }
  return next;
}

async function collectWorkspaceDefaultsOption(
  opts: SetupCliOptions,
  rl: ReturnType<typeof createInterface>,
): Promise<SetupCliOptions> {
  if (opts.ejectDefaults !== undefined) return opts;

  console.log("\nWorkspace defaults:");
  console.log("  1. Safe defaults (refresh system files, preserve existing config/prompts)");
  console.log("  2. Eject packaged defaults (write missing workflow/prompts for manual editing)");
  const answer = (await rl.question("Select [1]: ")).trim();
  const selected = answer ? Number(answer) : 1;
  if (selected === 1) return { ...opts, ejectDefaults: false };
  if (selected === 2) return { ...opts, ejectDefaults: true };
  throw new Error(`Invalid workspace defaults option: ${answer}`);
}

async function collectInteractiveSetupDetails(
  opts: SetupCliOptions,
  runtime: PluginRuntime,
): Promise<SetupCliOptions> {
  if (!process.stdin.isTTY) return opts;

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    let next = { ...opts };
    if ((next.newAgent || next.agent) && !next.channelBinding) {
      next = { ...next, ...await collectChannelBinding(rl, runtime, next.agent) };
    }
    next = await collectModelOptions(next, rl);
    next = await collectWorkspaceDefaultsOption(next, rl);
    return next;
  } finally {
    rl.close();
  }
}

async function resolveSetupCliOptions(
  opts: SetupCliOptions,
  runtime: PluginRuntime,
): Promise<SetupCliOptions> {
  if (opts.newAgent || opts.agent || opts.workspace) return opts;
  if (!process.stdin.isTTY) {
    throw new Error(
      "Interactive setup requires a terminal. Use --new-agent <name>, --agent <id>, or --workspace <path> for non-interactive setup.",
    );
  }

  const agents = getConfiguredAgents(runtime);
  const defaultWorkspace = getDefaultWorkspaceDir(runtime);
  const defaultAgentIndex = Math.max(
    0,
    agents.findIndex((agent) => agent.workspace === defaultWorkspace),
  );

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    console.log("DevClaw setup target:");
    agents.forEach((agent, index) => {
      const label = formatAgentLabel(agent);
      const workspace = agent.workspace ? ` — ${agent.workspace}` : "";
      console.log(`  ${index + 1}. Configure existing agent: ${label}${workspace}`);
    });
    const createNewOption = agents.length + 1;
    const workspaceOption = agents.length + 2;
    console.log(`  ${createNewOption}. Create a new agent`);
    console.log(`  ${workspaceOption}. Configure a workspace path directly`);

    const answer = (
      await rl.question(`Select [${defaultAgentIndex + 1}]: `)
    ).trim();
    const selected = answer ? Number(answer) : defaultAgentIndex + 1;

    if (Number.isInteger(selected) && selected >= 1 && selected <= agents.length) {
      return { ...opts, agent: agents[selected - 1]?.id };
    }

    if (selected === createNewOption) {
      const name = (await rl.question("New agent name: ")).trim();
      if (!name) throw new Error("New agent name is required");
      return { ...opts, newAgent: name };
    }

    if (selected === workspaceOption) {
      const workspace = (await rl.question("Workspace path: ")).trim();
      if (!workspace) throw new Error("Workspace path is required");
      return { ...opts, workspace };
    }

    throw new Error(`Invalid setup target: ${answer}`);
  } finally {
    rl.close();
  }
}

/**
 * Register the `devclaw` CLI command group on a Commander program.
 */
export function registerCli(program: Command, ctx: PluginContext): void {
  const devclaw = program
    .command("devclaw")
    .description("DevClaw development pipeline tools");

  const setupCmd = devclaw
    .command("setup")
    .description("Set up DevClaw: create agent, configure models, write workspace files")
    .option("--new-agent <name>", "Create a new agent with this name")
    .option("--agent <id>", "Use an existing agent by ID")
    .option("--workspace <path>", "Direct workspace path")
    .option("--channel-binding <channel>", "Channel binding for a new agent: telegram, whatsapp, or none")
    .option("--channel-account-id <id>", "Channel account id for routing bindings, defaults to default")
    .option("--channel-peer-id <id>", "Group/topic peer id for routing bindings, e.g. -100123:topic:331")
    .option("--migrate-from <agentId>", "Migrate an existing channel-wide binding from this agent")
    .option("--project-execution <mode>", "Project execution mode: parallel or sequential")
    .option("--eject-defaults", "Write missing packaged defaults into the workspace");

  // Register dynamic --<role>-<level> options from registry
  const defaults = getAllDefaultModels();
  for (const role of getAllRoleIds()) {
    for (const level of getLevelsForRole(role)) {
      const flag = `--${role}-${level}`;
      setupCmd.option(`${flag} <model>`, `${role.toUpperCase()} ${level} model (default: ${defaults[role]?.[level] ?? "auto"})`);
    }
  }

  setupCmd.action(async (rawOpts: SetupCliOptions) => {
    try {
      const opts = await collectInteractiveSetupDetails(
        await resolveSetupCliOptions(rawOpts, ctx.runtime),
        ctx.runtime,
      );
      printSelectedSetupTarget(opts, ctx.runtime);

      // Build model overrides from CLI flags dynamically
      const models: Record<string, Record<string, string>> = {};

      for (const role of getAllRoleIds()) {
        const roleModels: Record<string, string> = {};
        for (const level of getLevelsForRole(role)) {
          // camelCase key: "testerJunior" for --tester-junior, "developerMedior" for --developer-medior
          const key = `${role}${level.charAt(0).toUpperCase()}${level.slice(1)}`;
          const model = opts[key];
          if (typeof model === "string" && model) roleModels[level] = model;
        }
        if (Object.keys(roleModels).length > 0) models[role] = roleModels;
      }

      const scopePreflight = await ensureRequiredOpenClawScopes(ctx.runCommand);
      const result = await runSetup({
        runtime: ctx.runtime,
        newAgentName: opts.newAgent,
        channelBinding: normalizeChannelBinding(opts.channelBinding),
        channelAccountId: opts.channelAccountId,
        channelPeerId: opts.channelPeerId,
        migrateFrom: opts.migrateFrom,
        agentId: opts.agent,
        workspacePath: opts.workspace,
        models: Object.keys(models).length > 0 ? models : undefined,
        ejectDefaults: opts.ejectDefaults === true,
        projectExecution: normalizeProjectExecution(opts.projectExecution),
      });

      if (result.agentCreated) {
        console.log(`Agent "${result.agentId}" created`);
      }
      console.log("Setup target:");
      console.log(`  Agent: ${result.agentId}`);
      console.log(`  Workspace: ${result.workspacePath}`);
      console.log(`  Channel binding: ${result.channelBinding ?? "none"}`);
      if (result.channelAccountId) console.log(`  Channel account: ${result.channelAccountId}`);
      if (result.channelPeerId) console.log(`  Channel peer: ${result.channelPeerId}`);
      if (result.bindingMigrated) {
        console.log(`  Binding migrated from: ${result.bindingMigrated.from}`);
      }
      console.log(`  Workspace defaults: ${result.defaultsEjected ? "ejected packaged defaults" : "safe defaults"}`);

      console.log("Models configured:");
      for (const [role, levels] of Object.entries(result.models)) {
        for (const [level, model] of Object.entries(levels)) {
          console.log(`  ${role}.${level}: ${model}`);
        }
      }

      console.log("Files written:");
      for (const file of result.filesWritten) {
        console.log(`  ${file}`);
      }

      if (scopePreflight.status === "approved") {
        console.log("\nOpenClaw scopes: approved");
      }
      if (scopePreflight.warning) {
        console.log("\nOpenClaw scopes warning:");
        console.log(`  ${scopePreflight.warning}`);
      }

      if (result.warnings.length > 0) {
        console.log("\nWarnings:");
        for (const w of result.warnings) {
          console.log(`  ${w}`);
        }
      }
      console.log("\nDone!");
      console.log("Next steps are messages/actions, not shell menu choices:");
      console.log("  - Restart the OpenClaw gateway so the new bot/chat binding becomes active.");
      console.log("  - Add the bot to the selected Telegram/WhatsApp chat.");
      console.log('  - In that group, send: "Register project <name> at <repo> with base branch <branch>".');
      console.log("  - Create the first issue and ask DevClaw to pick it up.");
    } catch (err) {
      if (isScopeApprovalRequiredError(err)) {
        console.error("OpenClaw scope approval required.");
        console.error(`Missing scopes: ${err.missingScopes.join(", ")}`);
        console.error(`Approval request: ${err.requestId}`);
        console.error("Approve this request in OpenClaw UI or CLI, then rerun: openclaw devclaw setup");
        process.exitCode = 1;
        return;
      }

      if (isScopeApprovalRejectedError(err)) {
        console.error(err.message);
        process.exitCode = 1;
        return;
      }

      throw err;
    }
  });

  devclaw
    .command("repair")
    .description("Repair DevClaw managed projections")
    .command("sprint")
    .description("Repair a sprint provider projection")
    .requiredOption("--project <slug>", "Project slug")
    .requiredOption("--root-issue <id>", "Sprint root issue id")
    .requiredOption("--source <source>", "Repair source: local-state or provider")
    .option("--workspace <path>", "Workspace path, defaults to OpenClaw agent workspace")
    .action(async (opts: SprintRepairCliOptions) => {
      const workspaceDir = opts.workspace ?? getDefaultWorkspaceDir(ctx.runtime);
      if (!workspaceDir) throw new Error("Workspace path is required. Pass --workspace <path>.");
      if (!opts.project) throw new Error("--project is required.");
      const source = opts.source;
      if (source !== "local-state" && source !== "provider") {
        throw new Error("--source must be local-state or provider.");
      }
      const sprintRootIssueId = Number(opts.rootIssue);
      if (!Number.isInteger(sprintRootIssueId) || sprintRootIssueId <= 0) {
        throw new Error("--root-issue must be a positive integer.");
      }

      const result = await repairSprint({
        workspaceDir,
        ctx,
        projectSlug: opts.project,
        sprintRootIssueId,
        source,
      });

      console.log(`Sprint repair complete: ${opts.project}:${sprintRootIssueId}`);
      console.log(`  source: ${result.source}`);
      console.log(`  repaired: ${result.repaired.length}`);
      for (const entry of result.repaired) console.log(`  - ${entry}`);
    });
}
