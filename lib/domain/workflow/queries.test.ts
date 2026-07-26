import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_ROLES,
  DEFAULT_WORKFLOW,
  getRevertLabel,
  STATE_TYPE,
  WORKFLOW_EVENT,
  WORKFLOW_STATE_COLORS,
  WORKFLOW_STATE_KEYS,
  WORKFLOW_STATE_LABELS,
  type WorkflowConfig,
} from "../index.js";

describe("getRevertLabel", () => {
  it("matches an object-form PICKUP transition target", () => {
    const workflow: WorkflowConfig = {
      ...DEFAULT_WORKFLOW,
      states: {
        ...DEFAULT_WORKFLOW.states,
        [WORKFLOW_STATE_KEYS.TODO]: {
          type: STATE_TYPE.QUEUE,
          role: DEFAULT_ROLES.DEVELOPER,
          label: WORKFLOW_STATE_LABELS.TODO,
          color: WORKFLOW_STATE_COLORS.TODO,
          priority: 10,
          on: {
            [WORKFLOW_EVENT.PICKUP]: WORKFLOW_STATE_KEYS.RESEARCHING,
          },
        },
        [WORKFLOW_STATE_KEYS.TO_IMPROVE]: {
          type: STATE_TYPE.QUEUE,
          role: DEFAULT_ROLES.DEVELOPER,
          label: WORKFLOW_STATE_LABELS.TO_IMPROVE,
          color: WORKFLOW_STATE_COLORS.TO_IMPROVE,
          priority: 1,
          on: {
            [WORKFLOW_EVENT.PICKUP]: {
              target: WORKFLOW_STATE_KEYS.DOING,
            },
          },
        },
      },
    };

    assert.equal(
      getRevertLabel(workflow, DEFAULT_ROLES.DEVELOPER),
      WORKFLOW_STATE_LABELS.TO_IMPROVE,
    );
  });
});
