/** Verifies forbidden setup adapter dependencies across POSIX and Windows paths. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkApplicationDependencyDirection, checkSetupAdapterBoundary } from "../../scripts/architecture-rules.js";

describe("setup architecture boundaries", () => {
  it("rejects state and filesystem imports in all migrated adapters", () => {
    for (const source of ["lib/tools/admin/setup.ts", "lib/tools/admin/config.ts", "lib/tools/admin/onboard.ts", "lib/cli/commands/setup-command.ts", "lib/cli/commands/doctor-command.ts"]) {
      for (const name of [source, source.replaceAll("/", "\\")]) {
        assert.ok(checkSetupAdapterBoundary(name, "state", "../../state/index.js"));
        for (const specifier of ["node:fs", "node:fs/promises", "fs", "fs/promises"]) {
          assert.ok(checkSetupAdapterBoundary(name, undefined, specifier));
        }
        assert.equal(checkSetupAdapterBoundary(name, "application", "../../application/setup/index.js"), null);
      }
    }
  });
  it("allows filesystem persistence inside its owning layer", () => {
    assert.equal(checkSetupAdapterBoundary("lib/state/setup/workspace-files.ts", undefined, "node:fs/promises"), null);
  });
});

it("rejects reverse dependencies from state and application into their callers", () => {
  assert.ok(checkApplicationDependencyDirection("state", "application"));
  for (const layer of ["tools", "cli"]) {
    assert.ok(checkApplicationDependencyDirection("state", layer));
    assert.ok(checkApplicationDependencyDirection("application", layer));
    assert.equal(checkApplicationDependencyDirection(layer, "application"), null);
  }
  assert.equal(checkApplicationDependencyDirection("application", "state"), null);
});
