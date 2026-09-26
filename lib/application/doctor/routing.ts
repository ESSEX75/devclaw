/**
 * Builds routing and agent-isolation diagnostics for the DevClaw doctor command.
 * It combines persisted projects with live OpenClaw bindings and tool policies without mutation.
 */

import { loadConfig } from "../../state/index.js";
import { type ProjectsData, readProjects } from "../../state/index.js";
import { getIssueArchiveStatus, parseDuration } from "../issues/index.js";
import { DEVCLAW_AGENT_TOOLS, inspectConfiguredProjectRoutes } from "../setup/index.js";
import type { DoctorFinding, DoctorRuntime, RoutingDoctorReport } from "./types.js";

/** Inspect routes, retention, and isolation without writes or command calls.
 * @param runtime - Read-only OpenClaw configuration source.
 * @param workspaceDir - Workspace containing managed project state.
 */
export async function runRoutingDoctor(
  runtime: DoctorRuntime,
  workspaceDir: string,
): Promise<RoutingDoctorReport> {
  const config = runtime.config.current();
  const projects = await readProjects(workspaceDir);

  const report = buildRoutingDoctorReport(config, projects);

  for (const project of Object.values(projects.projects)) {
    const resolved = await loadConfig(workspaceDir, project.slug);

    report.archives.push({ projectSlug: project.slug, ...await getIssueArchiveStatus({
      workspaceDir,
      projectSlug: project.slug,
      archiveRetention: resolved.issueArchiveMaintenance.archiveRetention,
      deletedProviderRetention: resolved.issueArchiveMaintenance.deletedProviderRetention,
      workflow: resolved.workflow,
    }) });
    if (parseDuration(resolved.issueArchiveMaintenance.archiveRetention) < parseDuration(resolved.issueArchiveMaintenance.attachmentsRetention)) {
      report.findings.push({
        code: "archive.retention_order",
        severity: "info",
        message: `${project.slug}: archiveRetention is shorter than attachmentsRetention; attachments are purged with the archive record.`,
      });
    }
  }

  report.ok = report.findings.every((finding) => finding.severity !== "error");

  return report;
}

/** Build a doctor report from already loaded configuration and project state. */
export function buildRoutingDoctorReport(
  config: ReturnType<DoctorRuntime["config"]["current"]>,
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
    archives: [],
  };
}
