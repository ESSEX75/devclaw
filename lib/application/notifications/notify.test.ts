import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getNotificationConfig, notify, type NotificationRuntime } from "./index.js";
import type { RunCommand } from "../../context.js";
import { NOTIFICATION_CHANNEL } from "../../domain/index.js";

async function readAuditEvents(workspaceDir: string): Promise<Array<Record<string, unknown>>> {
  try {
    const content = await fs.readFile(path.join(workspaceDir, "devclaw", "log", "audit.log"), "utf-8");
    return content.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function runtimeWithSendText(
  sendText: (payload: unknown) => Promise<unknown>,
): NotificationRuntime {
  return {
    config: {
      current: () => ({
        agents: { list: [{ id: "dev-agent" }] },
        channels: { telegram: { enabled: true, accounts: { dev: {} } } },
        bindings: [{
          agentId: "dev-agent",
          match: {
            channel: "telegram",
            accountId: "dev",
            peer: { id: "telegram:123" },
          },
        }],
      }),
    },
    channel: {
      outbound: {
        loadAdapter: async () => ({ sendText }),
      },
    },
  };
}

function runtimeWithoutSender(): NotificationRuntime {
  return {
    ...runtimeWithSendText(async () => undefined),
    channel: { outbound: { loadAdapter: async () => ({}) } },
  };
}

describe("notifications", () => {
  it("accepts only boolean toggles for supported events", () => {
    assert.deepEqual(getNotificationConfig({ notifications: {
      workerStart: false, prMerged: "false", unrelated: false,
    } }), { workerStart: false });
  });

  it("blocks delivery when the exact route is not bound to the project agent", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-notify-"));
    const calls: string[][] = [];
    const runCommand: RunCommand = async (argv: string[]) => {
      calls.push(argv);

      return { stdout: "{}", stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
    };

    try {
      const result = await notify({
        type: "changesRequested",
        project: "test-project",
        issueId: 10,
        issueUrl: "https://example.com/issues/10",
        issueTitle: "Needs changes",
      }, {
        workspaceDir: tmpDir,
        channelId: "another-chat",
        channel: NOTIFICATION_CHANNEL.TELEGRAM,
        accountId: "dev",
        agentId: "dev-agent",
        runtime: runtimeWithSendText(async () => ({ messageId: "unexpected" })),
        runCommand,
      });

      assert.equal(result, null);
      assert.equal(calls.length, 0);
      const events = await readAuditEvents(tmpDir);

      assert.deepEqual(events.map((event) => event.event), ["notify_configuration_error"]);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("uses the actual target branch in PR merged messages", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-notify-"));
    const calls: string[][] = [];
    const runCommand: RunCommand = async (argv: string[]) => {
      calls.push(argv);
      return { stdout: "{}", stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
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
          accountId: "dev",
          agentId: "dev-agent",
          runtime: runtimeWithoutSender(),
          runCommand,
        },
      );

      assert.strictEqual(sent?.path, "fallback");
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
      return { stdout: "{}", stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
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
          accountId: "dev",
          agentId: "dev-agent",
          runtime: runtimeWithSendText(async (payload) => {
            sentPayloads.push(payload);
            return { messageId: "message-10" };
          }),
          runCommand,
        },
      );

      assert.strictEqual(sent?.path, "runtime");
      assert.strictEqual(sent?.messageId, "message-10");
      assert.strictEqual(sentPayloads.length, 1);
      assert.strictEqual(calls.length, 0);

      const events = await readAuditEvents(tmpDir);
      assert.deepStrictEqual(events.map((event) => event.event), ["notify_attempt", "notify_sent"]);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("records one fallback success after runtime delivery fails", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-notify-"));
    const calls: string[][] = [];
    const runCommand: RunCommand = async (argv: string[]) => {
      calls.push(argv);
      return { stdout: "{}", stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
    };

    try {
      const result = await notify(
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
          accountId: "dev",
          agentId: "dev-agent",
          runtime: runtimeWithSendText(async () => {
            throw new Error("runtime send failed");
          }),
          runCommand,
        },
      );

      assert.strictEqual(result?.path, "fallback");
      assert.strictEqual(calls.length, 1);
      const events = await readAuditEvents(tmpDir);
      assert.deepStrictEqual(events.map((event) => event.event), ["notify_attempt", "notify_sent"]);
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
          accountId: "dev",
          agentId: "dev-agent",
          runtime: runtimeWithSendText(async () => {
            throw new Error("runtime send failed");
          }),
        },
      );

      assert.strictEqual(sent, null);

      const events = await readAuditEvents(tmpDir);
      const errors = events.filter((event) => event.event === "notify_failed");
      assert.deepStrictEqual(events.map((event) => event.event), ["notify_attempt", "notify_failed"]);
      assert.strictEqual(errors.length, 1);
      assert.match(String(errors[0]!.error), /runtime send failed/);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("uses command fallback when loading the runtime adapter fails", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-notify-"));
    const calls: string[][] = [];
    const runCommand: RunCommand = async (argv: string[]) => {
      calls.push(argv);
      return { stdout: "{}", stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
    };
    const runtime: NotificationRuntime = {
      ...runtimeWithSendText(async () => undefined),
      channel: { outbound: { loadAdapter: async () => { throw new Error("adapter unavailable"); } } },
    };

    try {
      const result = await notify({
        type: "changesRequested", project: "test-project", issueId: 10,
        issueUrl: "https://example.com/issues/10", issueTitle: "Needs changes",
      }, {
        workspaceDir: tmpDir, channelId: "telegram:123", channel: NOTIFICATION_CHANNEL.TELEGRAM,
        accountId: "dev", agentId: "dev-agent", runtime, runCommand,
      });

      assert.equal(result?.path, "fallback");
      assert.equal(calls.length, 1);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("records a failed delivery when the command exits nonzero", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-notify-"));
    const runCommand: RunCommand = async () => ({
      stdout: "", stderr: "delivery rejected", code: 1, signal: null, killed: false, termination: "exit",
    });

    try {
      const result = await notify({
        type: "changesRequested", project: "test-project", issueId: 10,
        issueUrl: "https://example.com/issues/10", issueTitle: "Needs changes",
      }, {
        workspaceDir: tmpDir, channelId: "telegram:123", channel: NOTIFICATION_CHANNEL.TELEGRAM,
        accountId: "dev", agentId: "dev-agent", runtime: runtimeWithoutSender(), runCommand,
      });

      assert.equal(result, null);
      const events = await readAuditEvents(tmpDir);
      assert.deepEqual(events.map((event) => event.event), ["notify_attempt", "notify_failed"]);
      assert.match(String(events[1]?.error), /code 1/);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it("returns a successful receipt when the sent audit record cannot be written", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-notify-"));
    let sent = 0;
    let fallback = 0;
    const runCommand: RunCommand = async () => {
      fallback++;
      return { stdout: "{}", stderr: "", code: 0, signal: null, killed: false, termination: "exit" };
    };
    const runtime = runtimeWithSendText(async () => {
      sent++;
      const auditPath = path.join(tmpDir, "devclaw", "log", "audit.log");

      await fs.rm(auditPath);
      await fs.mkdir(auditPath);
      return { messageId: "delivered-10" };
    });

    try {
      const receipt = await notify({
        type: "changesRequested", project: "test-project", issueId: 10,
        issueUrl: "https://example.com/issues/10", issueTitle: "Needs changes",
      }, {
        workspaceDir: tmpDir, channelId: "telegram:123", channel: NOTIFICATION_CHANNEL.TELEGRAM,
        accountId: "dev", agentId: "dev-agent", runtime, runCommand,
      });

      assert.equal(receipt?.messageId, "delivered-10");
      assert.equal(sent, 1);
      assert.equal(fallback, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });
});
