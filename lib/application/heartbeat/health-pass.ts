/** Coordinates read-only worker diagnosis and optional remedies across configured roles. */

import { getConfiguredRoleIds } from "../../state/index.js";
import { checkWorkerHealth, type HealthFix,scanOrphanedLabels, scanStatelessIssues } from "./health.js";
import type { HealthPassInput } from "./types.js";

/** Inspect all health categories, applying remedies only when explicitly requested.
 * @param input - Project dependencies and explicit diagnosis/remediation mode.
 */
export async function performHealthPass(input: HealthPassInput): Promise<HealthFix[]> {
  const { workspaceDir, projectSlug, project, sessions, provider, resolvedConfig, staleWorkerHours,
    instanceName, runCommand, stallTimeoutMinutes, agentId, autoFix } = input;
  const findings: HealthFix[] = [];
  const collect = async (role: string, run: () => Promise<HealthFix[]>): Promise<void> => {
    try { findings.push(...await run()); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      findings.push({ issue: { type: "inspection_failed", severity: "critical", project: project.name, projectSlug, role, message }, fixed: false, error: message });
    }
  };

  for (const role of getConfiguredRoleIds(resolvedConfig)) {
    // Check worker health (session liveness, label consistency, etc)
    await collect(role, () => checkWorkerHealth({
      workspaceDir,
      projectSlug,
      project,
      role,
      sessions,
      autoFix,
      provider,
      workflow: resolvedConfig.workflow,
      staleWorkerHours,
      stallTimeoutMinutes,
      runCommand,
      agentId,
    }));

    // Scan for orphaned labels (active labels with no tracking worker)
    await collect(role, () => scanOrphanedLabels({
      workspaceDir,
      projectSlug,
      project,
      role,
      autoFix,
      provider,
      workflow: resolvedConfig.workflow,
      instanceName,
    }));
  }

  // Scan for stateless issues (managed issues that lost their state label — #473)
  await collect("", () => scanStatelessIssues({
    workspaceDir,
    projectSlug,
    project,
    provider,
    workflow: resolvedConfig.workflow,
    autoFix,
    instanceName,
  }));

  return findings;
}
