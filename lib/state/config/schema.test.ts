import assert from "node:assert";
import { describe, it } from "node:test";

import { validateConfig } from "./schema.js";

describe("workflow config schema", () => {
  it("accepts explicit completion result mappings", () => {
    assert.doesNotThrow(() => validateConfig({
      roles: {
        developer: {
          completion: {
            done: "COMPLETE",
            blocked: "BLOCKED",
          },
        },
      },
    }));
  });

  it("rejects the removed completion results array", () => {
    assert.throws(() => validateConfig({
      roles: {
        developer: {
          completionResults: ["done", "blocked"],
        },
      },
    }));
  });

  it("rejects completion mappings to unknown workflow events", () => {
    assert.throws(() => validateConfig({
      roles: {
        developer: {
          completion: {
            done: "UNKNOWN",
          },
        },
      },
    }));
  });

  it("rejects string-form workflow transitions", () => {
    assert.throws(() => validateConfig({
      workflow: {
        states: {
          todo: {
            type: "queue",
            role: "developer",
            label: "To Do",
            color: "#428bca",
            on: {
              PICKUP: "doing",
            },
          },
        },
      },
    }));
  });

  it("accepts object-form workflow transitions", () => {
    assert.doesNotThrow(() => validateConfig({
      workflow: {
        states: {
          todo: {
            type: "queue",
            role: "developer",
            label: "To Do",
            color: "#428bca",
            on: {
              PICKUP: {
                target: "doing",
                description: "Start development",
              },
            },
          },
        },
      },
    }));
  });

  it("rejects unknown transition properties", () => {
    assert.throws(() => validateConfig({
      workflow: {
        states: {
          todo: {
            type: "queue",
            role: "developer",
            label: "To Do",
            color: "#428bca",
            on: {
              PICKUP: {
                target: "doing",
                destination: "doing",
              },
            },
          },
        },
      },
    }));
  });
});
