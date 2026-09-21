/** Reads YAML configuration while preserving unknown input until schema validation. */
import fs from "node:fs/promises";

import YAML from "yaml";

import { isErrnoException } from "../persistence/index.js";

/**
 * Read and parse one optional YAML configuration file while preserving its value as unknown.
 * Missing files produce null; malformed YAML and other filesystem failures retain path context.
 *
 * @param filePath - Concrete optional YAML file to read.
 */
export async function readYamlFile(filePath: string): Promise<unknown | null> {
  try {
    const parsed: unknown = YAML.parse(await fs.readFile(filePath, "utf-8"));

    return parsed ?? null;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return null;
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Cannot read YAML config ${filePath}: ${message}`, { cause: error });
  }
}
