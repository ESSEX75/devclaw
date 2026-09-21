/** Loads packaged setup templates explicitly so filesystem failures stay in the calling use case. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RoleId } from "../../domain/index.js";
import {
  AGENTS_FILE_NAME,
  HEARTBEAT_FILE_NAME,
  IDENTITY_FILE_NAME,
  ROLE_TEMPLATE_PATHS,
  SOUL_FILE_NAME,
  TOOLS_FILE_NAME,
  WORKFLOW_TEMPLATE_PATH,
} from "./const.js";
import { resolveDefaultsDirectory } from "./package-root.js";
import type { SetupTemplates } from "./types.js";

/** Active or fulfilled template load shared by concurrent and later setup operations. */
let cachedTemplates: Promise<SetupTemplates> | undefined;

/**
 * Load and cache packaged templates, clearing a failed attempt so a later call can retry disk access.
 */
export async function loadSetupTemplates(): Promise<SetupTemplates> {
  const loading = cachedTemplates ??= loadTemplates();

  try {
    return await loading;
  } catch (error) {
    if (cachedTemplates === loading) cachedTemplates = undefined;

    throw error;
  }
}

/** Read the packaged template set from the source or bundled runtime layout. */
async function loadTemplates(): Promise<SetupTemplates> {
  const defaultsDir = await resolveDefaultsDirectory(path.dirname(fileURLToPath(import.meta.url)));
  const read = async (name: string): Promise<string> => {
    const filePath = path.join(defaultsDir, name);

    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      throw new Error(`Cannot load setup template ${filePath}: ${message}`, { cause: error });
    }
  };

  const [agents, heartbeat, identity, soul, tools, workflow] = await Promise.all([
    read(AGENTS_FILE_NAME),
    read(HEARTBEAT_FILE_NAME),
    read(IDENTITY_FILE_NAME),
    read(SOUL_FILE_NAME),
    read(TOOLS_FILE_NAME),
    read(WORKFLOW_TEMPLATE_PATH),
  ]);
  const roleInstructions: Record<RoleId, string> = {
    developer: await read(ROLE_TEMPLATE_PATHS.developer),
    tester: await read(ROLE_TEMPLATE_PATHS.tester),
    architect: await read(ROLE_TEMPLATE_PATHS.architect),
    reviewer: await read(ROLE_TEMPLATE_PATHS.reviewer),
  };

  return { agents, heartbeat, identity, soul, tools, workflow, roleInstructions };
}
