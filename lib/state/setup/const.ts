/**
 * Defines filesystem names and packaged-template paths shared by the state setup capability.
 */
import type { RoleId } from "../../domain/index.js";

/** Name of the managed role-prompt directory. */
export const PROMPTS_DIRECTORY_NAME = "prompts";

/** Name of the managed runtime log directory. */
export const LOG_DIRECTORY_NAME = "log";

/** Name of the packaged defaults directory at the DevClaw package root. */
export const DEFAULTS_DIRECTORY_NAME = "defaults";

/** Filename used to identify the DevClaw package root. */
export const PACKAGE_MANIFEST_FILE_NAME = "package.json";

/** Package name required when accepting a manifest as the DevClaw package root. */
export const DEVCLAW_PACKAGE_NAME = "@laurentenhoor/devclaw";

/** Filename of the root agent instructions. */
export const AGENTS_FILE_NAME = "AGENTS.md";

/** Filename of the root heartbeat instructions. */
export const HEARTBEAT_FILE_NAME = "HEARTBEAT.md";

/** Filename of the root identity document. */
export const IDENTITY_FILE_NAME = "IDENTITY.md";

/** Filename of the root agent persona document. */
export const SOUL_FILE_NAME = "SOUL.md";

/** Filename of the root tool instructions. */
export const TOOLS_FILE_NAME = "TOOLS.md";

/** Filename of the optional user document copied during scaffolding. */
export const USER_FILE_NAME = "USER.md";

/** Extension used by packaged and workspace role instruction files. */
export const ROLE_PROMPT_FILE_EXTENSION = ".md";

/** Suffix used for recoverable backups created during explicit replacement. */
export const BACKUP_FILE_SUFFIX = ".bak";

/** Relative packaged-template path for the workspace workflow configuration. */
export const WORKFLOW_TEMPLATE_PATH = "devclaw/workflow.yaml";

/** Relative packaged-template paths for built-in role instructions. */
export const ROLE_TEMPLATE_PATHS = {
  developer: "devclaw/prompts/developer.md",
  tester: "devclaw/prompts/tester.md",
  architect: "devclaw/prompts/architect.md",
  reviewer: "devclaw/prompts/reviewer.md",
} satisfies Readonly<Record<RoleId, string>>;
