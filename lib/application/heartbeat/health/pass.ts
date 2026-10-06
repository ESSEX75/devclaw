/** Coordinates read-only worker diagnosis and optional remedies across configured roles. */

import { getConfiguredRoleIds } from "../../../state/index.js";
import { HEALTH_ISSUE_SEVERITY, HEALTH_ISSUE_TYPE } from "./const.js";
import type { HealthFix, HealthPassInput } from "./types.js";
import { checkWorkerHealth } from "./worker-slot-health.js";

/** Inspect all health categories, applying remedies only when explicitly requested.
 * @param input - Project dependencies and explicit diagnosis/remediation mode.
 */
export async function performHealthPass(input: HealthPassInput): Promise<HealthFix[]> {
  const {
    workspaceDir,
    projectSlug,
    project,
    sessions,
    provider,
    resolvedConfig,
    staleWorkerHours,
    runCommand,
    stallTimeoutMinutes,
    agentId,
    autoFix,
  } = input;
  const findings: HealthFix[] = [];

  const collect = async (role: string, run: () => Promise<HealthFix[]>): Promise<void> => {
    try { findings.push(...await run()); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      findings.push({
        issue: {
          type: HEALTH_ISSUE_TYPE.INSPECTION_FAILED,
          severity: HEALTH_ISSUE_SEVERITY.CRITICAL,
          project: project.name, projectSlug, role, message,
        },
        fixed: false,
        error: message,
      });
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
  }

  return findings;
}
