/** Verifies the application rejection exposed by work_finish when no matching worker exists. */

import assert from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createTestHarness } from "../../testing/index.js";
import { finishWork } from "../../application/workers/index.js";
import { writeIssueRuntimeState } from "../../application/issue-runtime/index.js";
import { DEFAULT_WORKFLOW, ISSUE_PROVIDER } from "../../domain/index.js";

/** Audit fixture location asserted by the adapter regression. */
const AUDIT_PATH = ["devclaw", "log", "audit.log"];

describe("work_finish rejection", () => {
  describe("missing active worker rejection", () => {
    it("should audit work_finish rejection when no active worker is found", async () => {
      const h = await createTestHarness();
      try {
        const issue = h.provider.seedIssue({
          iid: 77,
          title: "Stale testing issue",
          labels: ["Testing", "tester:senior"],
        });
        await writeIssueRuntimeState({
          workspaceDir: h.workspaceDir,
          project: h.project,
          issue,
          providerType: ISSUE_PROVIDER.GITHUB,
          workflow: DEFAULT_WORKFLOW,
          workflowState: "testing",
          workflowLabel: "Testing",
          assignedRole: "tester",
          assignedLevel: "senior",
          activeWorker: null,
        });

        await assert.rejects(
          finishWork({
            workspaceDir: h.workspaceDir,
            channelId: h.channelId,
            role: "tester",
            result: "pass",
            runCommand: h.runCommand,
          }),
          /TESTER worker not active/,
        );

        const auditPath = join(h.workspaceDir, ...AUDIT_PATH);
        const content = await readFile(auditPath, "utf-8");
        const entries = content.split("\n").filter(Boolean).map((line) => JSON.parse(line));
        const rejection = entries.find((entry) =>
          entry.event === "work_finish_rejected" &&
          entry.reason === "missing_active_worker"
        );

        assert.ok(rejection, "Expected work_finish_rejected audit event");
        assert.strictEqual(rejection.project, h.project.name);
        assert.strictEqual(rejection.projectSlug, h.project.slug);
        assert.strictEqual(rejection.issue, null);
        assert.strictEqual(rejection.role, "tester");
        assert.strictEqual(rejection.result, "pass");
        assert.strictEqual(rejection.activeWorkflowLabel, "Testing");
        assert.deepStrictEqual(rejection.candidateIssues, [
          {
            issueId: 77,
            workflowState: "testing",
            workflowLabel: "Testing",
            activeWorker: null,
          },
        ]);
      } finally {
        await h.cleanup();
      }
    });
  });
});
