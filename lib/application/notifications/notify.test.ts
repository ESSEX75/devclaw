import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { notify } from "./notify.js";
import type { RunCommand } from "../../context.js";

describe("notifications", () => {
  it("uses the actual target branch in PR merged messages", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-notify-"));
    const calls: string[][] = [];
    const runCommand: RunCommand = async (argv: string[]) => {
      calls.push(argv);
      return { stdout: "{}", stderr: "", exitCode: 0 } as never;
    };

    try {
      const sent = await notify(
        {
          type: "prMerged",
          project: "test-project",
          issueId: 73,
          issueUrl: "https://example.com/issues/73",
          issueTitle: "Fix message",
          prUrl: "https://example.com/pull/74",
          prTitle: "Fix pipeline verification message",
          sourceBranch: "feature/73-fix-user-message-text",
          targetBranch: "development",
          mergedBy: "pipeline",
        },
        {
          workspaceDir: tmpDir,
          channelId: "telegram:123",
          channel: "telegram",
          runCommand,
        },
      );

      assert.strictEqual(sent, true);
      assert.strictEqual(calls.length, 1);
      const messageIndex = calls[0]!.indexOf("--message");
      assert.notStrictEqual(messageIndex, -1);
      const message = calls[0]![messageIndex + 1]!;
      assert.match(message, /feature\/73-fix-user-message-text → development/);
      assert.doesNotMatch(message, /→ main/);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });
});
