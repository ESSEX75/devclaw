import assert from "node:assert";
import { describe, it } from "node:test";

import { validateConfig, validateRoleIntegrity, validateWorkflowIntegrity } from "./schema.js";

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

  it("rejects unknown fields, events, actions, and checks", () => {
    const state = {
      type: "queue",
      role: "developer",
      label: "To Do",
      color: "#428bca",
    };

    assert.throws(() => validateConfig({ unknown: true }));
    assert.throws(() => validateConfig({
      workflow: { states: { todo: { ...state, unknown: true } } },
    }));
    assert.throws(() => validateConfig({
      workflow: { states: { todo: { ...state, on: { UNKNOWN: { target: "doing" } } } } },
    }));
    assert.throws(() => validateConfig({
      workflow: { states: { todo: { ...state, on: { PICKUP: { target: "doing", actions: ["unknown"] } } } } },
    }));
    assert.throws(() => validateConfig({
      workflow: { states: { todo: { ...state, check: "unknown" } } },
    }));
  });

  it("rejects malformed identifiers and labels", () => {
    assert.throws(() => validateConfig({
      roles: { "invalid role": { levels: ["standard"] } },
    }));
    assert.throws(() => validateConfig({
      workflow: {
        states: {
          todo: {
            type: "hold",
            label: "",
            color: "#428bca",
          },
        },
      },
    }));
  });
});

describe("merged role integrity", () => {
  it("reports missing custom-role fields and invalid level references", () => {
    const errors = validateRoleIntegrity({
      security_auditor: {
        levels: ["standard"],
        defaultLevel: "expert",
        models: {
          expert: "model/expert",
        },
        emoji: {
          expert: "🔐",
        },
        completion: {},
      },
    }, new Set(["developer"]));

    assert.ok(errors.some((error) => error.includes("defaultLevel")));
    assert.ok(errors.some((error) => error.includes("models.standard")));
    assert.ok(errors.some((error) => error.includes("models.expert")));
    assert.ok(errors.some((error) => error.includes("emoji.expert")));
    assert.ok(errors.some((error) => error.includes("completion")));
  });

  it("rejects disabling an undefined custom role", () => {
    assert.deepEqual(
      validateRoleIntegrity({ security_auditor: false }, new Set(["developer"])),
      ["roles.security_auditor: a custom role cannot be declared as false"],
    );
  });
});

describe("resolved workflow integrity", () => {
  it("reports missing roles, targets, duplicate labels, and reserved labels", () => {
    const errors = validateWorkflowIntegrity({
      initial: "missing",
      states: {
        first: {
          type: "queue",
          role: "missing_role",
          label: "owner:main",
          on: {
            PICKUP: { target: "missingTarget" },
          },
        },
        second: {
          type: "terminal",
          label: "owner:main",
        },
      },
    }, new Set(["developer"]));

    assert.ok(errors.some((error) => error.includes("workflow.initial")));
    assert.ok(errors.some((error) => error.includes("workflow.states.first.role")));
    assert.ok(errors.some((error) => error.includes("missingTarget")));
    assert.ok(errors.some((error) => error.includes("reserved")));
    assert.ok(errors.some((error) => error.includes("duplicates")));
  });
});
