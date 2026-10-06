/** Verifies complexity precedence, whole-word matching, phrase matching, and length thresholds. */

import assert from "node:assert/strict";
import { it } from "node:test";

import { isTaskComplexity } from "./guards.js";
import { classifyTaskComplexity } from "./task-complexity.js";

it("gives complex signals priority in short tasks with simple keywords", () => {
  assert.equal(classifyTaskComplexity("Simple security refactor", "Minor CSS change").complexity, "complex");
});

it("does not match simple or complex keywords inside unrelated words", () => {
  assert.equal(classifyTaskComplexity("Copyright notice", "Compare stylistic preferences").complexity, "medium");
  assert.equal(classifyTaskComplexity("Microarchitectures", "Evaluate options").complexity, "medium");
});

it("matches phrases across whitespace and explicit architectural variants", () => {
  assert.equal(classifyTaskComplexity("DATABASE\tSCHEMA", "").complexity, "complex");
  assert.equal(classifyTaskComplexity("Architectural refactoring", "").complexity, "complex");
  assert.equal(classifyTaskComplexity("Update\ntext", "").complexity, "simple");
});

it("counts trimmed words and respects the exclusive length thresholds", () => {
  assert.equal(classifyTaskComplexity("", "   ").complexity, "medium");
  assert.equal(classifyTaskComplexity("simple", "word ".repeat(98)).complexity, "simple");
  assert.equal(classifyTaskComplexity("simple", "word ".repeat(99)).complexity, "medium");
  assert.equal(classifyTaskComplexity("", "word ".repeat(500)).complexity, "medium");
  assert.equal(classifyTaskComplexity("", "word ".repeat(501)).complexity, "complex");
});

it("validates explicit complexity at the unknown input boundary", () => {
  for (const value of ["simple", "medium", "complex"]) assert.equal(isTaskComplexity(value), true);
  for (const value of [undefined, null, {}, 1, "senior", "COMPLEX"]) assert.equal(isTaskComplexity(value), false);
});
