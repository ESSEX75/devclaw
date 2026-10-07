/** Verifies built-in snapshot isolation, level contracts, and default projection queries. */

import assert from "node:assert/strict";
import { it } from "node:test";

import { DEFAULT_ROLES, isBuiltInLevelId } from "../../domain/index.js";
import { getAllBuiltInDefaultModels, getAllRoleIds, getBuiltInLevelsForRole, getBuiltInRole, getBuiltInSessionKeyRolePattern, getFallbackEmoji, requireBuiltInRole } from "./queries.js";

it("exposes every built-in role with a complete default scale", () => {
  assert.deepEqual(new Set(getAllRoleIds()), new Set(Object.values(DEFAULT_ROLES)));

  for (const id of getAllRoleIds()) {
    const role = requireBuiltInRole(id);
    const levels = getBuiltInLevelsForRole(id);

    assert.equal(role.id, id);
    assert.ok(role.displayName);
    assert.ok(levels.length > 0);
    assert.ok(levels.includes(role.defaultLevel));
    assert.ok(Object.keys(role.completion).length > 0);
    assert.ok(role.fallbackEmoji);
    const ranks = new Set<number>();

    for (const level of levels) {
      const definition = role.levels[level];

      assert.ok(definition);
      assert.ok(isBuiltInLevelId(level));
      assert.ok(Number.isInteger(definition.rank) && definition.rank > 0);
      assert.ok(!ranks.has(definition.rank));
      ranks.add(definition.rank);
      assert.ok(definition.model);
      assert.ok(definition.emoji);
    }
  }
});

it("does not classify custom roles as built-in roles", () => {
  assert.equal(getBuiltInRole("security_auditor"), undefined);
  assert.deepEqual(getBuiltInLevelsForRole("security_auditor"), []);
  assert.throws(() => requireBuiltInRole("security_auditor"), /Unknown built-in role/);
  assert.equal(getFallbackEmoji("security_auditor"), "📋");
});

it("keeps default data isolated from mutations to returned snapshots", () => {
  const role = requireBuiltInRole("developer");
  const junior = role.levels.junior;

  assert.ok(junior);
  const model = junior.model;
  const completion = role.completion.done;

  Object.defineProperty(junior, "model", { value: "model/mutated" });
  Object.defineProperty(role.completion, "done", { value: "BLOCKED" });
  assert.equal(requireBuiltInRole("developer").levels.junior?.model, model);
  assert.equal(requireBuiltInRole("developer").completion.done, completion);
});

it("projects independent default assignments and session alternatives", () => {
  const models = getAllBuiltInDefaultModels();

  for (const id of getAllRoleIds()) {
    for (const level of getBuiltInLevelsForRole(id)) {
      assert.equal(models[id][level], requireBuiltInRole(id).levels[level]?.model);
    }
    assert.ok(new RegExp(`^(?:${getBuiltInSessionKeyRolePattern()})$`).test(id));
  }

  models.developer.junior = "model/mutated";
  assert.notEqual(getAllBuiltInDefaultModels().developer.junior, "model/mutated");
  assert.equal(new RegExp(`^(?:${getBuiltInSessionKeyRolePattern()})$`).test("security_auditor"), false);
});
