import { createInterface } from "node:readline/promises";

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import { getAllDefaultModels, getAllRoleIds, getLevelsForRole } from "../../roles/index.js";
import {
  formatAgentLabel,
  formatSelectedChannelBinding,
  getConfiguredAgents,
  getDefaultWorkspaceDir,
  type SetupCliOptions,
} from "../options/setup-options.js";

type ChannelAccountChoice = {
  channel: "telegram" | "whatsapp";
  accountId: string;
  label: string;
  peerId?: string;
};

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

export async function collectInteractiveSetupDetails(
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

export async function resolveSetupCliOptions(
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

export function printSelectedSetupTarget(opts: SetupCliOptions, runtime: PluginRuntime): void {
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
