/**
 * Verifies user-facing workflow transition descriptions.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getNextStateDescription,
  STATE_TYPE,
  WORKFLOW_EVENT,
  type WorkflowConfig,
} from "./index.js";

function createWorkflow(targetDescription?: string): WorkflowConfig {
  return {
    initial: "queued",
    states: {
      queued: {
        type: STATE_TYPE.QUEUE,
        role: "developer",
        label: "Queued",
        color: "#111111",
        on: {
          [WORKFLOW_EVENT.PICKUP]: { target: "working" },
        },
      },
      working: {
        type: STATE_TYPE.ACTIVE,
        role: "developer",
        label: "Working",
        color: "#222222",
        on: {
          [WORKFLOW_EVENT.COMPLETE]: { target: "rejected" },
        },
      },
      rejected: {
        type: STATE_TYPE.TERMINAL,
        label: "Rejected",
        color: "#333333",
        description: targetDescription,
      },
    },
  };
}

describe("getNextStateDescription", () => {
  it("falls back to the configured target label", () => {
    assert.equal(
      getNextStateDescription(createWorkflow(), "developer", WORKFLOW_EVENT.COMPLETE),
      "Rejected",
    );
  });

  it("prefers the configured target description", () => {
    assert.equal(
      getNextStateDescription(
        createWorkflow("Work was rejected"),
        "developer",
        WORKFLOW_EVENT.COMPLETE,
      ),
      "Work was rejected",
    );
  });

  it("returns an empty description when no transition exists", () => {
    assert.equal(
      getNextStateDescription(createWorkflow(), "reviewer", WORKFLOW_EVENT.COMPLETE),
      "",
    );
  });
});
