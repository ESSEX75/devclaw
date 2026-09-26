/** Builds isolated agent tool permissions without mutating the source configuration. */
import { DEVCLAW_AGENT_TOOL_SET, DEVCLAW_AGENT_TOOLS, DEVCLAW_DENIED_TOOLS } from "./const.js";
import type { AgentToolPolicy } from "./types.js";

/** Preserve unrelated permissions and isolate DevClaw tools to authorized owners.
 * @param current - Existing per-agent policy, if configured.
 * @param authorized - Whether setup or project ownership authorizes this agent.
 */
export function buildAgentToolPolicy(current: AgentToolPolicy | undefined, authorized: boolean): AgentToolPolicy {
  const policy = { ...current };

  if (authorized) {
    if (current?.allow?.length) {
      policy.allow = [...new Set([...current.allow, ...(current.alsoAllow ?? []), ...DEVCLAW_AGENT_TOOLS])];
      delete policy.alsoAllow;
    } else {
      policy.alsoAllow = [...new Set([...(current?.alsoAllow ?? []), ...DEVCLAW_AGENT_TOOLS])];
    }

    policy.deny = [...new Set([...(current?.deny ?? []).filter(tool => !DEVCLAW_AGENT_TOOL_SET.has(tool)), ...DEVCLAW_DENIED_TOOLS])];
  } else {
    policy.deny = [...new Set([...(current?.deny ?? []), ...DEVCLAW_AGENT_TOOLS])];
    if (current?.allow) policy.allow = current.allow.filter(tool => !DEVCLAW_AGENT_TOOL_SET.has(tool));
    if (current?.alsoAllow) policy.alsoAllow = current.alsoAllow.filter(tool => !DEVCLAW_AGENT_TOOL_SET.has(tool));
  }

  return policy;
}
