/** Coordinates worker completion after unambiguous slot selection and mandatory PR checks. */

import { log as auditLog } from "../../../audit.js";
import { COMPLETION_RESULT, DEFAULT_ROLES } from "../../../domain/index.js";
import { resolveRepoPath } from "../../../state/index.js";
import { executeCompletion } from "../../pipeline/index.js";
import { resolveProvider } from "../../projects/index.js";
import { WORKER_AUDIT_EVENT } from "../const.js";
import { loadFinishWorkContext } from "./finish-context.js";
import { validateFinishPullRequest } from "./finish-preconditions.js";
import type { FinishWorkInput, FinishWorkResult } from "./types.js";

/** Finish the captured worker run; provider lookup failures do not authorize completion.
 * @param input - Adapter request and runtime capabilities.
 */
export async function finishWork(input: FinishWorkInput): Promise<FinishWorkResult> {
  const { workspaceDir, role, result, summary, prUrl, createdTasks, runCommand, pluginConfig, runtime } = input;
  const { project, config, issueId, worker } = await loadFinishWorkContext(input);
  const { provider } = await resolveProvider(workspaceDir, project, runCommand);
  const repoPath = resolveRepoPath(project.repo);

  //TODO: The behavior of the tester, reviewer, etc. is hard-coded.
  if (role === DEFAULT_ROLES.DEVELOPER && result === COMPLETION_RESULT.DONE) {
    await validateFinishPullRequest(provider, issueId);
  }

  const completion = await executeCompletion({
    workspaceDir, projectSlug: project.slug, role, result, issueId,
    summary, prUrl, provider, repoPath, projectName: project.name, channels: project.channels, pluginConfig,
    level: worker.level, slotIndex: worker.slotIndex, runtime, workflow: config.workflow, createdTasks, runCommand,
    expectedWorker: worker
  });

  await auditLog(workspaceDir, WORKER_AUDIT_EVENT.FINISHED, {
    project: project.name, projectSlug: project.slug,
    issue: issueId, role, result, summary: summary ?? null, labelTransition: completion.labelTransition
  });

  return { success: true, project: project.name, projectSlug: project.slug, issueId, role, result, ...completion };
}
