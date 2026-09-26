/** Builds deterministic doctor findings from loaded routing and archive observations. */
import type { ProjectsData, ResolvedConfig } from "../../state/index.js";
import { parseDuration } from "../issues/index.js";
import { DEVCLAW_AGENT_TOOLS, inspectConfiguredProjectRoutes } from "../setup/index.js";
import { DOCTOR_FINDING_CODE, DOCTOR_SEVERITY } from "./const.js";
import type { DoctorArchiveReport, DoctorFinding, DoctorRuntime, RoutingDoctorReport } from "./types.js";

/** Build routing, isolation, and archive diagnostics without performing I/O.
 * @param config - Current OpenClaw routes and explicit agent tool policies.
 * @param projects - Validated project registry identifying route and tool owners.
 * @param archiveReport - Completed archive observations, including project read failures.
 */
export function buildRoutingDoctorReport(
  config: ReturnType<DoctorRuntime["config"]["current"]>,
  projects: ProjectsData,
  archiveReport: DoctorArchiveReport = { archives: [], findings: [] },
): RoutingDoctorReport {
  const findings: DoctorFinding[] = [];
  const projectAgentIds = new Set(Object.values(projects.projects).map((project) => project.agentId));

  for (const result of inspectConfiguredProjectRoutes(config, projects)) {
    for (const diagnostic of result.diagnostics) {
      findings.push({
        code: diagnostic.code,
        severity: DOCTOR_SEVERITY.ERROR,
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
        code: DOCTOR_FINDING_CODE.OWNER_TOOLS_INCOMPLETE,
        severity: DOCTOR_SEVERITY.ERROR,
        message: `Project agent "${agent.id}" does not explicitly allow every DevClaw tool.`,
      });
    }

    if (!ownsProject && (anyAllowed || !allDenied)) {
      findings.push({
        code: DOCTOR_FINDING_CODE.FOREIGN_AGENT_TOOLS_VISIBLE,
        severity: DOCTOR_SEVERITY.ERROR,
        message: `Non-project agent "${agent.id}" is not explicitly denied every DevClaw tool.`,
      });
    }

    const explicitAllowedTool = (agent.tools?.alsoAllow ?? []).some((tool) => toolNames.has(tool));

    return { agentId: agent.id, devclawToolsAllowed: ownsProject && allAllowed && explicitAllowedTool };
  });

  if (findings.length === 0) {
    findings.push({
      code: DOCTOR_FINDING_CODE.ROUTING_OK,
      severity: DOCTOR_SEVERITY.INFO,
      message: "All project routes and agent tool policies are valid.",
    });
  }

  findings.push(...archiveReport.findings);

  return {
    ok: findings.every((finding) => finding.severity !== DOCTOR_SEVERITY.ERROR),
    findings,
    agents,
    archives: [...archiveReport.archives],
  };
}

/** Explain retention ordering without claiming that cleanup has already succeeded.
 * @param projectSlug - Project whose retention settings were read successfully.
 * @param retention - Resolved archive and attachment retention policies.
 */
export function inspectArchiveRetention(
  projectSlug: string,
  retention: ResolvedConfig["issueArchiveMaintenance"],
): DoctorFinding[] {
  if (parseDuration(retention.archiveRetention) >= parseDuration(retention.attachmentsRetention)) return [];

  return [{
    code: DOCTOR_FINDING_CODE.RETENTION_ORDER,
    severity: DOCTOR_SEVERITY.INFO,
    message: `${projectSlug}: archiveRetention is shorter than attachmentsRetention; verify attachment cleanup before archive records expire.`,
  }];
}
