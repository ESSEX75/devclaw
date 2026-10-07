/** Applies session model selection and validates the gateway's persisted selection acknowledgement. */

import { z } from "zod";

import type { RunCommand } from "../../../context.js";
import { isCompleteCommandOutput,isCompletedCommand } from "../../process/index.js";
import { GATEWAY_COMMAND, SESSION_PATCH_METHOD } from "./const.js";

/** Gateway acknowledgement includes the canonical session key and resolved model identity. */
const SessionModelConfirmationSchema = z.object({
  ok: z.literal(true),
  key: z.string().trim().min(1),
  resolved: z.object({
    modelProvider: z.string().trim().min(1),
    model: z.string().trim().min(1),
  }),
});

/** Apply the requested model and await its persisted gateway acknowledgement.
 * Rejects command failure, timeout, malformed output, or acknowledgement of another session.
 * The gateway owns model alias resolution; its resolved identity may differ from the input alias.
 * This operation submits no worker turn, so failure never implies that task execution began.
 * @param sessionKey - Exact deterministic worker session whose model must be configured.
 * @param model - Configured model selection validated and resolved by the gateway.
 * @param runCommand - Plugin-owned command transport for the gateway RPC.
 * @param timeoutMs - Maximum command wait before dispatch must stop without submitting work.
 * @param label - Optional presentation label assigned alongside the model.
 */
export async function ensureSessionModel(
  sessionKey: string,
  model: string,
  runCommand: RunCommand,
  timeoutMs: number,
  label?: string,
): Promise<void> {
  if (!sessionKey.trim() || !model.trim()) throw new Error("Session model setup requires a nonempty session key and model.");
  const params = { key: sessionKey, model, ...(label ? { label } : {}) };

  try {
    const result = await runCommand(
      [...GATEWAY_COMMAND, SESSION_PATCH_METHOD, "--params", JSON.stringify(params), "--json"],
      { timeoutMs },
    );

    if (!isCompletedCommand(result) || !isCompleteCommandOutput(result) || result.code !== 0) {
      throw new Error(`Gateway model patch failed (${result.termination}, exit ${result.code}): ${result.stderr}`);
    }

    const lines = result.stdout.trim().split("\n");
    const jsonStart = lines.findIndex(line => line.trimStart().startsWith("{"));

    if (jsonStart < 0) throw new Error("Gateway model patch returned no JSON acknowledgement.");
    const response: unknown = JSON.parse(lines.slice(jsonStart).join("\n"));
    const confirmed = SessionModelConfirmationSchema.parse(response);

    // Worker keys contain no opaque provider peer IDs; the gateway folds their case.
    if (confirmed.key.toLowerCase() !== sessionKey.trim().toLowerCase()) {
      throw new Error(`Gateway model patch acknowledged another session: "${confirmed.key}".`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Session model setup failed for "${sessionKey}": ${message}`, { cause: error });
  }
}
