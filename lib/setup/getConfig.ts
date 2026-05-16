// lib/setup/getConfig.ts
/**
 * Unified helper to obtain the current OpenClaw configuration.
 * Newer OpenClaw versions expose `runtime.config.current` while older
 * versions still provide `loadConfig()`. This function abstracts the
 * difference so the rest of the codebase can call a single method.
 */
export const getConfig = (runtime: any): Record<string, unknown> => {
  // Prefer the new property if it exists.
  if (runtime?.config?.current) {
    return runtime.config.current as Record<string, unknown>;
  }
  // Fallback to the deprecated API for backward compatibility.
  if (typeof runtime?.config?.loadConfig === "function") {
    return runtime.config.loadConfig() as Record<string, unknown>;
  }
  throw new Error("Unable to obtain OpenClaw configuration from runtime");
};
