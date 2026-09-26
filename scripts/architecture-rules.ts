/** Pure adapter boundary policy shared by the architecture checker and regression tests. */
/** Adapters whose setup and diagnostic effects must pass through application commands. */
const APPLICATION_ADAPTERS = new Set([
  "lib/tools/admin/setup.ts", "lib/tools/admin/config.ts", "lib/tools/admin/onboard.ts",
  "lib/cli/commands/setup-command.ts", "lib/cli/commands/doctor-command.ts",
]);

/** Detect direct persistence dependencies in adapters migrated to shared application commands.
 * @param source - Repository-relative source path, with either platform separator.
 * @param targetLayer - Resolved target layer for local imports.
 * @param specifier - Raw import specifier for external modules.
 */
export function checkSetupAdapterBoundary(source: string, targetLayer: string | undefined, specifier: string): string | null {
  if (APPLICATION_ADAPTERS.has(source.replaceAll("\\", "/")) &&
    (targetLayer === "state" || ["node:fs", "node:fs/promises", "fs", "fs/promises"].includes(specifier))) {
    return "setup and doctor adapters must use application commands instead of filesystem state";
  }
  return null;
}

/** Enforce orchestration direction independently of public entrypoint checks.
 * @param sourceLayer - Layer containing the importer.
 * @param targetLayer - Resolved imported layer, absent for external packages.
 */
export function checkApplicationDependencyDirection(sourceLayer: string, targetLayer: string | undefined): string | null {
  if (sourceLayer === "state" && ["application", "tools", "cli"].includes(targetLayer ?? "")) {
    return "state must not depend on application orchestration or adapters";
  }
  if (sourceLayer === "application" && ["tools", "cli"].includes(targetLayer ?? "")) {
    return "application must not depend on tool or CLI adapters";
  }
  return null;
}
