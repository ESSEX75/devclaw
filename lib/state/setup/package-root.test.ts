/**
 * Verifies package-root discovery against source-like and installed-package directory layouts.
 */
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULTS_DIRECTORY_NAME,
  DEVCLAW_PACKAGE_NAME,
  PACKAGE_MANIFEST_FILE_NAME,
} from "./const.js";
import { findDevClawPackageRoot, resolveDefaultsDirectory } from "./package-root.js";

/** Package-manifest fragment required by the published-file smoke test. */
type PackageFileManifest = {
  /** Package-relative paths included in the published archive. */
  files: string[];
};

/** Prefix used for isolated installed-package layout fixtures. */
const PACKAGE_LAYOUT_TEST_PREFIX = "devclaw-package-layout-";

/** Directory name representing bundled JavaScript inside an installed package. */
const BUNDLE_DIRECTORY_NAME = "dist";

/** Nested source path used to prove discovery is independent of module depth. */
const SOURCE_MODULE_SEGMENTS = ["lib", "state", "setup"];

/** Package allowlist entry that ships the runtime setup templates. */
const PACKAGED_DEFAULTS_DIRECTORY = "defaults/";

/** Package allowlist entry that ships the bundled plugin entrypoint. */
const PACKAGED_BUNDLE_ENTRY = "dist/index.js";

/** Temporary package fixture removed after each package-layout test. */
let temporaryPackageRoot: string | undefined;

afterEach(async () => {
  if (temporaryPackageRoot) await fs.rm(temporaryPackageRoot, { recursive: true, force: true });
  temporaryPackageRoot = undefined;
});

describe("DevClaw package root resolution", () => {
  it("resolves one defaults directory from source and bundled module locations", async () => {
    temporaryPackageRoot = await fs.mkdtemp(path.join(os.tmpdir(), PACKAGE_LAYOUT_TEST_PREFIX));
    const sourceDirectory = path.join(temporaryPackageRoot, ...SOURCE_MODULE_SEGMENTS);
    const bundleDirectory = path.join(temporaryPackageRoot, BUNDLE_DIRECTORY_NAME);
    const defaultsDirectory = path.join(temporaryPackageRoot, DEFAULTS_DIRECTORY_NAME);

    await Promise.all([
      fs.mkdir(sourceDirectory, { recursive: true }),
      fs.mkdir(bundleDirectory, { recursive: true }),
      fs.mkdir(defaultsDirectory, { recursive: true }),
    ]);
    await fs.writeFile(
      path.join(temporaryPackageRoot, PACKAGE_MANIFEST_FILE_NAME),
      JSON.stringify({ name: DEVCLAW_PACKAGE_NAME }),
      "utf-8",
    );

    assert.equal(await findDevClawPackageRoot(sourceDirectory), temporaryPackageRoot);
    assert.equal(await findDevClawPackageRoot(bundleDirectory), temporaryPackageRoot);
    assert.equal(await resolveDefaultsDirectory(bundleDirectory), defaultsDirectory);
  });

  it("rejects a directory tree without the DevClaw package manifest", async () => {
    temporaryPackageRoot = await fs.mkdtemp(path.join(os.tmpdir(), PACKAGE_LAYOUT_TEST_PREFIX));
    const packageRoot = temporaryPackageRoot;

    await fs.writeFile(
      path.join(packageRoot, PACKAGE_MANIFEST_FILE_NAME),
      JSON.stringify({ name: "unrelated-package" }),
      "utf-8",
    );

    await assert.rejects(
      () => findDevClawPackageRoot(packageRoot),
      /Cannot locate package root for @laurentenhoor\/devclaw/,
    );
  });

  it("declares bundled code and defaults in the published package allowlist", async () => {
    const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
    const packageRoot = await findDevClawPackageRoot(sourceDirectory);
    const manifest: unknown = JSON.parse(await fs.readFile(
      path.join(packageRoot, PACKAGE_MANIFEST_FILE_NAME),
      "utf-8",
    ));

    assert.ok(hasPackageFiles(manifest));
    assert.ok(manifest.files.includes(PACKAGED_BUNDLE_ENTRY));
    assert.ok(manifest.files.includes(PACKAGED_DEFAULTS_DIRECTORY));
  });
});

/**
 * Validate the package manifest fragment required by the package-layout smoke test.
 *
 * @param value - Unknown JSON value read from the repository package manifest.
 */
function hasPackageFiles(value: unknown): value is PackageFileManifest {
  return typeof value === "object"
    && value !== null
    && "files" in value
    && Array.isArray(value.files)
    && value.files.every((entry) => typeof entry === "string");
}
