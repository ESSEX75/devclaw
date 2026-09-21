/**
 * Resolves the installed DevClaw package root so setup assets use one explicit layout contract.
 */
import fs from "node:fs/promises";
import path from "node:path";

import {
  DEFAULTS_DIRECTORY_NAME,
  DEVCLAW_PACKAGE_NAME,
  PACKAGE_MANIFEST_FILE_NAME,
} from "./const.js";

/**
 * Locate the nearest ancestor whose package manifest identifies DevClaw.
 * Unrelated package manifests are skipped; malformed readable manifests fail with path context.
 *
 * @param startDirectory - Source or bundled module directory inside the DevClaw package.
 */
export async function findDevClawPackageRoot(startDirectory: string): Promise<string> {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    const manifestPath = path.join(currentDirectory, PACKAGE_MANIFEST_FILE_NAME);

    try {
      const manifest: unknown = JSON.parse(await fs.readFile(manifestPath, "utf-8"));

      if (isDevClawPackageManifest(manifest)) return currentDirectory;
    } catch (error) {
      if (!isMissingFileError(error)) {
        const message = error instanceof Error ? error.message : String(error);

        throw new Error(`Cannot inspect package manifest ${manifestPath}: ${message}`, { cause: error });
      }
    }

    const parentDirectory = path.dirname(currentDirectory);

    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }

  throw new Error(`Cannot locate package root for ${DEVCLAW_PACKAGE_NAME} from ${startDirectory}.`);
}

/**
 * Resolve the single supported packaged-defaults location below the identified package root.
 *
 * @param startDirectory - Source or bundled module directory inside the DevClaw package.
 */
export async function resolveDefaultsDirectory(startDirectory: string): Promise<string> {
  return path.join(await findDevClawPackageRoot(startDirectory), DEFAULTS_DIRECTORY_NAME);
}

/**
 * Check whether an unknown parsed manifest identifies the DevClaw package.
 *
 * @param value - Unknown JSON value read from a candidate package manifest.
 */
function isDevClawPackageManifest(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && "name" in value
    && value.name === DEVCLAW_PACKAGE_NAME;
}

/**
 * Check whether a filesystem failure means that a candidate manifest is absent.
 *
 * @param error - Unknown failure raised while reading a package manifest.
 */
function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
