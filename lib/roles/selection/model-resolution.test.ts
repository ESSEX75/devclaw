/** Verifies strict model lookup for custom levels, removed defaults, and invalid assignments. */

import assert from "node:assert/strict";
import { it } from "node:test";

import { resolveModelForLevel } from "./model-resolution.js";
import type { ResolvedRoleDefinition } from "./types.js";

/** Configured custom scale intentionally omitting all built-in levels. */
const configuredRole: ResolvedRoleDefinition = {
  levels: { expert: { rank: 1, model: "provider/configured-model" } },
  defaultLevel: "expert",
};

it("resolves only explicitly configured models", () => {
  assert.equal(resolveModelForLevel("expert", configuredRole), "provider/configured-model");
});

it("rejects removed levels, typos, raw model IDs, and inherited object keys", () => {
  for (const level of ["senior", "expret", "provider/configured-model", "toString", "__proto__"]) {
    assert.throws(() => resolveModelForLevel(level, configuredRole), /Unknown configured level/);
  }
});

it("rejects an empty model instead of applying a registry fallback", () => {
  assert.throws(() => resolveModelForLevel("junior", {
    levels: { junior: { rank: 1, model: " " } }, defaultLevel: "junior",
  }), /no model assignment/);
});
