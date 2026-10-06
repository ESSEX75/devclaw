/** Verifies heartbeat ownership discovery using active agent entries and explicit workspaces. */
import assert from "node:assert/strict";
import { it } from "node:test";

import { createTestHarness } from "../../../testing/index.js";
import { discoverAgents } from "./agent-discovery.js";

it("discovers dev-agent's project in its entries workspace", async () => {
  const harness = await createTestHarness();

  try {
    const result = await discoverAgents({ agents: { entries: {
      "dev-agent": { workspace: harness.workspaceDir },
    }, list: [{ id: "legacy", workspace: harness.workspaceDir }] } });
    await harness.writeProjects({ projects: { [harness.project.slug]: { ...harness.project, agentId: "dev-agent" } } });
    const discovered = await discoverAgents({ agents: { entries: {
      "dev-agent": { workspace: harness.workspaceDir },
    }, list: [{ id: "legacy", workspace: harness.workspaceDir }] } });

    assert.deepEqual(result.agents, []);
    assert.deepEqual(discovered, { agents: [{ agentId: "dev-agent", workspace: harness.workspaceDir }], errors: [] });
  } finally {
    await harness.cleanup();
  }
});
