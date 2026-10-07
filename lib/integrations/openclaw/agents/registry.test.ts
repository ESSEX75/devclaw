/** Verifies OpenClaw's active registry precedence and key-derived identity. */
import assert from "node:assert/strict";
import { it } from "node:test";

import { findConfiguredAgent, listConfiguredAgents } from "./registry.js";

it("reads entries-only agents by key", () => {
  const config = { agents: { entries: { "dev-agent": { name: "Developer" } } } };

  assert.deepEqual(listConfiguredAgents(config), [{ id: "dev-agent", name: "Developer" }]);
  assert.equal(findConfiguredAgent(config, "dev-agent")?.id, "dev-agent");
});

it("falls back to legacy list", () => {
  assert.deepEqual(listConfiguredAgents({ agents: { list: [{ id: "legacy" }] } }), [{ id: "legacy" }]);
});

it("entries wins over list, including an empty entries map", () => {
  assert.deepEqual(listConfiguredAgents({ agents: { entries: { current: {} }, list: [{ id: "legacy" }] } }), [{ id: "current" }]);
  assert.deepEqual(listConfiguredAgents({ agents: { entries: {}, list: [{ id: "legacy" }] } }), []);
});
