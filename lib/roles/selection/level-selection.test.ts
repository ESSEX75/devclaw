/** Verifies rank-based selection and explicit complexity overrides for custom role scales. */

import assert from "node:assert/strict";
import { it } from "node:test";

import { TASK_COMPLEXITY } from "../complexity/index.js";
import { selectLevel } from "./level-selection.js";
import type { ResolvedRoleDefinition } from "./types.js";

/** Unordered custom scale whose default differs from both rank endpoints. */
const configuredRole: ResolvedRoleDefinition = {
  levels: {
    expert: { rank: 30, model: "provider/deep" },
    apprentice: { rank: 10, model: "provider/fast" },
    standard: { rank: 20, model: "provider/balanced" },
  },
  defaultLevel: "standard",
};

it("uses ranks and the configured default independently of insertion order", () => {
  assert.equal(selectLevel("Fix typo", "", "custom_role", configuredRole).level, "apprentice");
  assert.equal(selectLevel("Simple security refactor", "", "custom_role", configuredRole).level, "expert");
  assert.equal(selectLevel("Add a button", "", "custom_role", configuredRole).level, "standard");
});

it("honors explicit complexity instead of reclassifying the task text", () => {
  assert.equal(selectLevel("Security refactor", "", "custom_role", configuredRole, TASK_COMPLEXITY.SIMPLE).level, "apprentice");
  assert.equal(selectLevel("Security refactor", "", "custom_role", configuredRole, TASK_COMPLEXITY.MEDIUM).level, "standard");
  assert.equal(selectLevel("Fix typo", "", "custom_role", configuredRole, TASK_COMPLEXITY.COMPLEX).level, "expert");
});

it("uses the only configured level for any complexity", () => {
  const singleRole = { levels: { expert: configuredRole.levels.expert }, defaultLevel: "expert" };

  for (const complexity of Object.values(TASK_COMPLEXITY)) {
    assert.equal(selectLevel("", "", "custom_role", singleRole, complexity).level, "expert");
  }
});

it("rejects an empty scale or missing default instead of selecting a built-in level", () => {
  assert.throws(() => selectLevel("", "", "custom_role", { levels: {}, defaultLevel: "standard" }), /no configured levels/);
  assert.throws(() => selectLevel("", "", "custom_role", { ...configuredRole, defaultLevel: "senior" }), /unknown default level/);
});
