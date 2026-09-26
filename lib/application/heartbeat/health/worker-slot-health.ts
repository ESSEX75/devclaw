/** Coordinates read-only worker diagnosis and explicitly requested remediation. */
import type { HealthFix, WorkerHealthInput } from "./types.js";
import { diagnoseWorkerHealth } from "./worker-diagnosis.js";
import { remediateWorkerHealth } from "./worker-remediation.js";

/** Diagnose persisted workers, applying proposed actions only when autoFix is explicit.
 * @param opts - Worker inspection dependencies and the caller's remediation choice.
 */
export async function checkWorkerHealth(opts: WorkerHealthInput & { autoFix: boolean }): Promise<HealthFix[]> {
  const findings = await diagnoseWorkerHealth(opts);

  if (!opts.autoFix) return findings;
  const results: HealthFix[] = [];

  for (const finding of findings) results.push(await remediateWorkerHealth(opts, finding));

  return results;
}
