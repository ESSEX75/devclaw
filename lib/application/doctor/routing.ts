/**
 * Builds routing and agent-isolation diagnostics for the DevClaw doctor command.
 * It combines persisted projects with live OpenClaw bindings and tool policies without mutation.
 */
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import type { ProjectsData } from "../../domain/index.js";
import { readProjects } from "../../state/projects/index.js";
import { DEVCLAW_AGENT_TOOLS } from "../setup/plugin-config.js";
import { inspectConfiguredProjectRoutes } from "../setup/route-validation.js";

/** One doctor finding with a stable code and severity. */
export type DoctorFinding = {
  /** Stable identifier for automation and support references. */
  code: string;
  /** Whether this finding blocks safe DevClaw routing. */
  severity: "error" | "info";
  /** Human-readable diagnostic message. */
  message: string;
};

/** Routing and tool-access matrix returned by the doctor application service. */
export type RoutingDoctorReport = {
  /** True when no blocking routing or isolation finding exists. */
  ok: boolean;
  /** Route and policy findings. */
  findings: DoctorFinding[];
  /** Explicit DevClaw tool access calculated for every configured agent. */
  agents: Array<{ agentId: string; devclawToolsAllowed: boolean }>;
};

/** Inspect project routes and explicit per-agent DevClaw tool isolation. */
export async function runRoutingDoctor(
  runtime: PluginRuntime,
  workspaceDir: string,
): Promise<RoutingDoctorReport> {
  const config = runtime.config.current();
  const projects = await readProjects(workspaceDir);

  return buildRoutingDoctorReport(config, projects);
}

/** Build a doctor report from already loaded configuration and project state. */
export function buildRoutingDoctorReport(
  config: ReturnType<PluginRuntime["config"]["current"]>,
  projects: ProjectsData,
): RoutingDoctorReport {
  const findings: DoctorFinding[] = [];
  const projectAgentIds = new Set(Object.values(projects.projects).map((project) => project.agentId));

  for (const result of inspectConfiguredProjectRoutes(config, projects)) {
    for (const diagnostic of result.diagnostics) {
      findings.push({
        code: diagnostic.code,
        severity: "error",
        message: `${result.project.slug}/${result.endpoint.name}: ${diagnostic.message}`,
      });
    }
  }

  const toolNames: ReadonlySet<string> = new Set(DEVCLAW_AGENT_TOOLS);
  const agents = (config.agents?.list ?? []).map((agent) => {
    const alsoAllow = new Set(agent.tools?.alsoAllow ?? []);
    const deny = new Set(agent.tools?.deny ?? []);
    const allAllowed = DEVCLAW_AGENT_TOOLS.every((tool) => alsoAllow.has(tool) && !deny.has(tool));
    const anyAllowed = DEVCLAW_AGENT_TOOLS.some((tool) => alsoAllow.has(tool) && !deny.has(tool));
    const allDenied = DEVCLAW_AGENT_TOOLS.every((tool) => deny.has(tool));
    const ownsProject = projectAgentIds.has(agent.id);

    if (ownsProject && !allAllowed) {
      findings.push({
        code: "isolation.owner_tools_incomplete",
        severity: "error",
        message: `Project agent "${agent.id}" does not explicitly allow every DevClaw tool.`,
      });
    }

    if (!ownsProject && (anyAllowed || !allDenied)) {
      findings.push({
        code: "isolation.foreign_agent_tools_visible",
        severity: "error",
        message: `Non-project agent "${agent.id}" is not explicitly denied every DevClaw tool.`,
      });
    }

    const explicitAllowedTool = (agent.tools?.alsoAllow ?? []).some((tool) => toolNames.has(tool));

    return { agentId: agent.id, devclawToolsAllowed: ownsProject && allAllowed && explicitAllowedTool };
  });

  if (findings.length === 0) {
    findings.push({
      code: "routing.ok",
      severity: "info",
      message: "All project routes and agent tool policies are valid.",
    });
  }

  return {
    ok: findings.every((finding) => finding.severity !== "error"),
    findings,
    agents,
  };
}
