import path from "node:path";
import { homedir } from "node:os";
import { DATA_DIR } from "../setup/migrate-layout.js";

export function projectsPath(workspaceDir: string): string {
  return path.join(workspaceDir, DATA_DIR, "projects.json");
}

/**
 * Resolve repo path from projects.json repo field (handles ~/ expansion).
 */
export function resolveRepoPath(repoField: string): string {
  if (repoField.startsWith("~/")) {
    return repoField.replace("~", homedir());
  }
  return repoField;
}
