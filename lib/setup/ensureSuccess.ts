// lib/setup/ensureSuccess.ts
/**
 * Throws if a runCommand result has a non‑zero exit code.
 */
export function ensureSuccess(result: { code?: number; stderr?: string }) {
  if (result.code != null && result.code !== 0) {
    throw new Error(result.stderr?.trim() || `Command failed with exit code ${result.code}`);
  }
}
