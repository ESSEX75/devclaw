/** Ensures interactive setup displays only agents from the active registry. */
import assert from "node:assert/strict";
import { it } from "node:test";

import { createSetupRuntime } from "../../testing/index.js";
import { getConfiguredAgents } from "./setup-options.js";

it("shows entries agents and ignores legacy list when both exist", () => {
  const { runtime } = createSetupRuntime({ agents: {
    entries: { "dev-agent": { name: "Developer" } },
    list: [{ id: "legacy" }],
  } });

  assert.deepEqual(getConfiguredAgents(runtime).map(agent => agent.id), ["dev-agent"]);
  assert.equal(getConfiguredAgents(runtime)[0]?.name, "Developer");
});
