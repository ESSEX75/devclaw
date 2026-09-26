/** Coordinates read-only doctor observations while isolating per-project archive failures. */
import { loadConfig, readProjects } from "../../state/index.js";
import { getIssueArchiveStatus } from "../issues/index.js";
import { DOCTOR_FINDING_CODE, DOCTOR_SEVERITY } from "./const.js";
import { buildRoutingDoctorReport, inspectArchiveRetention } from "./report.js";
import type { DoctorArchiveReport, DoctorRuntime, RoutingDoctorReport } from "./types.js";

/** Inspect routes, retention, and isolation without writes or command calls.
 * Project configuration or archive failures become blocking findings without losing other projects.
 * Failure to read the root configuration or project registry still rejects the inspection.
 * @param runtime - Read-only OpenClaw configuration source.
 * @param workspaceDir - Workspace containing managed project state.
 */
export async function runRoutingDoctor(
  runtime: DoctorRuntime,
  workspaceDir: string,
): Promise<RoutingDoctorReport> {
  const config = runtime.config.current();
  const projects = await readProjects(workspaceDir);
  const archiveReport: DoctorArchiveReport = { archives: [], findings: [] };

  for (const project of Object.values(projects.projects)) {
    try {
      const resolved = await loadConfig(workspaceDir, project.slug);

      archiveReport.findings.push(...inspectArchiveRetention(project.slug, resolved.issueArchiveMaintenance));
      const status = await getIssueArchiveStatus({
        workspaceDir,
        projectSlug: project.slug,
        archiveRetention: resolved.issueArchiveMaintenance.archiveRetention,
        deletedProviderRetention: resolved.issueArchiveMaintenance.deletedProviderRetention,
        workflow: resolved.workflow,
      });

      archiveReport.archives.push({ projectSlug: project.slug, ...status });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      archiveReport.findings.push({
        code: DOCTOR_FINDING_CODE.ARCHIVE_INSPECTION_FAILED,
        severity: DOCTOR_SEVERITY.ERROR,
        message: `${project.slug}: archive inspection failed: ${message}`,
      });
    }
  }

  return buildRoutingDoctorReport(config, projects, archiveReport);
}
