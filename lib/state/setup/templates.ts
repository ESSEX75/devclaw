/** Loads packaged setup templates explicitly so filesystem failures stay in the calling use case. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Complete packaged template set consumed by setup and runtime fallbacks. */
export type SetupTemplates = {
  /** Root agent instructions. */
  agents: string;
  /** Heartbeat instructions. */
  heartbeat: string;
  /** Initial identity document. */
  identity: string;
  /** Agent persona document. */
  soul: string;
  /** Tool instructions. */
  tools: string;
  /** Current workflow configuration example. */
  workflow: string;
  /** Role instructions indexed by built-in role identifier. */
  roleInstructions: Record<string, string>;
};

let cachedTemplates: Promise<SetupTemplates> | undefined;

/** Load and cache all packaged templates after the caller explicitly enters a setup-dependent flow. */
export function loadSetupTemplates(): Promise<SetupTemplates> {
  cachedTemplates ??= loadTemplates();

  return cachedTemplates;
}

/** Read the packaged template set from the source or bundled runtime layout. */
async function loadTemplates(): Promise<SetupTemplates> {
  const defaultsDir = await resolveDefaultsDir();
  const read = async (name: string): Promise<string> => {
    const filePath = path.join(defaultsDir, name);

    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      throw new Error(`Cannot load setup template ${filePath}: ${message}`, { cause: error });
    }
  };

  const [agents, heartbeat, identity, soul, tools, workflow, developer, tester, architect, reviewer] = await Promise.all([
    read("AGENTS.md"), read("HEARTBEAT.md"), read("IDENTITY.md"), read("SOUL.md"), read("TOOLS.md"),
    read("devclaw/workflow.yaml"), read("devclaw/prompts/developer.md"), read("devclaw/prompts/tester.md"),
    read("devclaw/prompts/architect.md"), read("devclaw/prompts/reviewer.md"),
  ]);

  return { agents, heartbeat, identity, soul, tools, workflow, roleInstructions: { developer, tester, architect, reviewer } };
}

/** Resolve the defaults directory across source and bundled runtime layouts. */
async function resolveDefaultsDir(): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(moduleDir, "..", "defaults"), path.join(moduleDir, "..", "..", "defaults"), path.join(moduleDir, "..", "..", "..", "defaults")];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);

      return candidate;
    } catch { /* inspect the next supported runtime layout */ }
  }

  return candidates[0]!;
}
