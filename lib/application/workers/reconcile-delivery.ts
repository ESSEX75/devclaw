/** Inspects durable ownership after an unresolved worker session submission. */
import { log as auditLog } from "../../audit.js";
import { fetchGatewaySessions } from "../../integrations/openclaw/gateway-sessions.js";
import { getProject, getRoleWorker, readIssueStateStore, readProjects } from "../../state/index.js";
import type { UnknownDispatchInput } from "./types.js";

/**
 * Compare the issue, slot, and gateway session before any future retry decision.
 * Absence is not proof of non-delivery, so this operation only records evidence.
 * @param input - Issue, slot, session, and transport diagnostic to inspect.
 */
export async function reconcileUncertainDispatch(input: UnknownDispatchInput): Promise<void> {
  const { workspaceDir, projectSlug, role, level, slotIndex, issueId, sessionKey, runCommand, reason } = input;
  const project = getProject(await readProjects(workspaceDir), projectSlug);
  const slot = project ? getRoleWorker(project, role).levels[level]?.[slotIndex] : undefined;
  const state = (await readIssueStateStore(workspaceDir, projectSlug)).issues[String(issueId)];
  const sessions = await fetchGatewaySessions(5_000, runCommand);

  await auditLog(workspaceDir, "dispatch_delivery_unknown", {
    projectSlug, issueId, role, level, slotIndex, sessionKey, reason,
    slotOwned: slot?.issueId === issueId && slot.sessionKey === sessionKey,
    runtimeOwned: state?.activeWorker?.sessionKey === sessionKey,
    sessionObserved: sessions ? sessions.has(sessionKey) : null,
  });
}
