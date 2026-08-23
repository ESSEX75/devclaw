import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { notify } from "./notify.js";
import type { RunCommand } from "../../context.js";
import { NOTIFICATION_CHANNEL } from "../../domain/index.js";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

async function readAuditEvents(workspaceDir: string): Promise<Array<Record<string, unknown>>> {
  try {
    const content = await fs.readFile(path.join(workspaceDir, "devclaw", "log", "audit.log"), "utf-8");
    return content.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function runtimeWithSendText(
  sendText: (payload: unknown) => Promise<void>,
): PluginRuntime {
  return {
    channel: {
      outbound: {
        loadAdapter: async () => ({ sendText }),
      },
    },
  } as unknown as PluginRuntime;
}

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
        channel: NOTIFICATION_CHANNEL.TELEGRAM,
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

  it("does not call CLI fallback or emit notify_error after runtime success", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-notify-"));
    const calls: string[][] = [];
    const sentPayloads: unknown[] = [];
    const runCommand: RunCommand = async (argv: string[]) => {
      calls.push(argv);
      return { stdout: "{}", stderr: "", exitCode: 0 } as never;
    };

    try {
      const sent = await notify(
        {
          type: "changesRequested",
          project: "test-project",
          issueId: 10,
          issueUrl: "https://example.com/issues/10",
          issueTitle: "Needs changes",
        },
        {
          workspaceDir: tmpDir,
          channelId: "telegram:123",
        channel: NOTIFICATION_CHANNEL.TELEGRAM,
          runtime: runtimeWithSendText(async (payload) => {
            sentPayloads.push(payload);
          }),
          runCommand,
        },
      );

      assert.strictEqual(sent, true);
      assert.strictEqual(sentPayloads.length, 1);
      assert.strictEqual(calls.length, 0);

      const events = await readAuditEvents(tmpDir);
      assert.strictEqual(events.filter((event) => event.event === "notify_error").length, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("emits one clear notify_error when runtime fails and fallback is unavailable", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-notify-"));

    try {
      const sent = await notify(
        {
          type: "changesRequested",
          project: "test-project",
          issueId: 10,
          issueUrl: "https://example.com/issues/10",
          issueTitle: "Needs changes",
        },
        {
          workspaceDir: tmpDir,
          channelId: "telegram:123",
        channel: NOTIFICATION_CHANNEL.TELEGRAM,
          runtime: runtimeWithSendText(async () => {
            throw new Error("runtime send failed");
          }),
        },
      );

      assert.strictEqual(sent, false);

      const errors = (await readAuditEvents(tmpDir)).filter((event) => event.event === "notify_error");
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0]!.fallbackAttempted, false);
      assert.strictEqual(errors[0]!.runtimeError, "runtime send failed");
      assert.strictEqual(errors[0]!.error, "Runtime notification failed and no command runner is available for fallback");
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });
});
