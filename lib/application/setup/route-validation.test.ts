/** Tests strict project route validation against OpenClaw configuration. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ISSUE_PROVIDER, NOTIFICATION_CHANNEL, type NotificationEndpoint } from "../../domain/index.js";
import {
  inspectProjectRoute,
  validateDestinationAvailability,
} from "./route-validation.js";

const endpoint: NotificationEndpoint = {
  channel: NOTIFICATION_CHANNEL.TELEGRAM,
  accountId: "dev",
  channelId: "-1003911014709",
  threadId: "5",
  name: "primary",
};

describe("strict project route validation", () => {
  it("accepts an exact account, peer, and agent binding", () => {
    const diagnostics = inspectProjectRoute({
      agents: { list: [{ id: "dev-agent" }] },
      channels: { telegram: { enabled: true, accounts: { dev: {} } } },
      bindings: [{
        agentId: "dev-agent",
        match: {
          channel: "telegram",
          accountId: "dev",
          peer: { id: "-1003911014709:topic:5" },
        },
      }],
    }, "dev-agent", endpoint);

    assert.deepEqual(diagnostics, []);
  });

  it("rejects a route bound to another agent", () => {
    const diagnostics = inspectProjectRoute({
      agents: { list: [{ id: "dev-agent" }, { id: "main" }] },
      channels: { telegram: { enabled: true, accounts: { dev: {} } } },
      bindings: [{
        agentId: "main",
        match: {
          channel: "telegram",
          accountId: "dev",
          peer: { id: "-1003911014709:topic:5" },
        },
      }],
    }, "dev-agent", endpoint);

    assert.ok(diagnostics.some((diagnostic) => (
      diagnostic.code === ROUTE_DIAGNOSTIC_CODE.BINDING_AGENT_MISMATCH
    )));
  });

  it("rejects the same exact destination in another project", () => {
    assert.throws(() => validateDestinationAvailability({
      projects: {
        first: {
          slug: "first",
          name: "First",
          agentId: "dev-agent",
          repo: "repo",
          baseBranch: "main",
          deployBranch: "main",
          provider: ISSUE_PROVIDER.GITHUB,
          channels: [endpoint],
          workers: {},
        },
      },
    }, "second", endpoint), /route\.destination_conflict/);
  });
});

import { ROUTE_DIAGNOSTIC_CODE } from "./const.js";
