/**
 * Tests for projects.ts — per-level worker state and accessors.
 * Run with: npx tsx --test lib/state/projects/projects.test.ts
 */
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  countActiveSlots,
  emptyRoleWorkerState,
  emptySlot,
  findFreeSlot,
  findSlotByIssue,
  ISSUE_PROVIDER,
  NOTIFICATION_CHANNEL,
  reconcileSlots,
  type RoleWorkerState,
} from "../../domain/index.js";
import {
  activateWorker,
  deactivateWorker,
  getProject,
  getRoleWorker,
  type ProjectsData,
  readProjects,
  updateProjects,
} from "./index.js";
import { projectsPath } from "./paths.js";
import { parseProjectsData } from "./schema.js";

/** Notification endpoint fragment accepted by the projects fixture builder. */
type ProjectFixtureChannel = {
  /** Provider-local channel identifier. */
  channelId: string;
  /** Transport used by the fixture endpoint. */
  channel: typeof NOTIFICATION_CHANNEL.TELEGRAM;
  /** Human-readable binding name. */
  name: string;
  /** OpenClaw account that owns the endpoint. */
  accountId: string;
  /** Optional transport thread identifier. */
  threadId?: string;
  /** Removed legacy field used by rejection tests. */
  topicId?: string;
};

/**
 * Persist a validated projects fixture directly for repository tests.
 *
 * @param workspaceDir - Isolated test workspace that owns the fixture.
 * @param data - Complete projects-registry fixture to serialize.
 */
async function writeProjectsFixture(workspaceDir: string, data: ProjectsData): Promise<void> {
  const filePath = projectsPath(workspaceDir);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

describe("project queries", () => {
  it("looks up projects only by their canonical slug", () => {
    const data = parseProjectsData(projectsFixture({
      channelId: "chat-1",
      channel: NOTIFICATION_CHANNEL.TELEGRAM,
      name: "primary",
      accountId: "dev",
    }));

    assert.equal(getProject(data, "devclaw")?.slug, "devclaw");
    assert.equal(getProject(data, "chat-1"), undefined);
  });
});

describe("readProjects", () => {
  it("rejects projects without an owning agent", () => {
    const fixture = projectsFixture({
      channelId: "chat-1",
      channel: NOTIFICATION_CHANNEL.TELEGRAM,
      name: "primary",
      accountId: "dev",
    });

    if (!isObjectRecord(fixture) || !isObjectRecord(fixture.projects)) {
      throw new Error("Invalid test fixture.");
    }
    const project = fixture.projects.devclaw;

    if (!isObjectRecord(project)) throw new Error("Invalid test project fixture.");
    delete project.agentId;

    assert.throws(() => parseProjectsData(fixture), /agentId/);
  });

  it("rejects endpoints without an explicit account", () => {
    assert.throws(() => parseProjectsData({
      projects: {
        devclaw: {
          slug: "devclaw",
          name: "devclaw",
          agentId: "dev-agent",
          repo: "repo",
          baseBranch: "main",
          deployBranch: "main",
          provider: ISSUE_PROVIDER.GITHUB,
          channels: [{
            channelId: "chat-1",
            channel: NOTIFICATION_CHANNEL.TELEGRAM,
            name: "primary",
          }],
          workers: {},
        },
      },
    }), /accountId/);
  });

  it("accepts a structured Telegram topic endpoint", () => {
    const data = parseProjectsData(projectsFixture({
      channelId: "-1003911014709",
      channel: NOTIFICATION_CHANNEL.TELEGRAM,
      name: "primary",
      accountId: "dev",
      threadId: "5",
    }));

    assert.equal(data.projects.devclaw?.channels[0]?.channelId, "-1003911014709");
    assert.equal(data.projects.devclaw?.channels[0]?.threadId, "5");
  });

  it("rejects unknown endpoint fields", () => {
    assert.throws(
      () => parseProjectsData(projectsFixture({
        channelId: "-1003911014709",
        channel: NOTIFICATION_CHANNEL.TELEGRAM,
        name: "primary",
        accountId: "dev",
        topicId: "5",
      })),
      /unrecognized key/i,
    );
  });

  it("treats different accounts as distinct transport destinations", () => {
    const fixture = projectsFixture({
      channelId: "-1003911014709",
      channel: NOTIFICATION_CHANNEL.TELEGRAM,
      name: "primary",
      accountId: "bot-a",
      threadId: "5",
    });

    if (!isObjectRecord(fixture)) throw new Error("Invalid test fixture root.");
    const projects = fixture.projects;

    if (!isObjectRecord(projects) || !isObjectRecord(projects.devclaw)) {
      throw new Error("Invalid test project fixture.");
    }

    projects.devclaw.channels = [
      {
        channelId: "-1003911014709",
        channel: NOTIFICATION_CHANNEL.TELEGRAM,
        name: "primary",
        accountId: "bot-a",
        threadId: "5",
      },
      {
        channelId: "-1003911014709",
        channel: NOTIFICATION_CHANNEL.TELEGRAM,
        name: "secondary",
        accountId: "bot-b",
        threadId: "5",
      },
    ];

    assert.doesNotThrow(() => parseProjectsData(fixture));
  });

  it("rejects removed project fields and string slot issue IDs", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-proj-"));
    const dataDir = path.join(tmpDir, "devclaw");

    await fs.mkdir(dataDir, { recursive: true });

    const projectFirstData = {
      projects: {
        "test": {
          slug: "test",
          name: "test",
          agentId: "test-agent",
          repo: "~/git/test",
          groupName: "Test",
          deployUrl: "https://example.test",
          baseBranch: "main",
          deployBranch: "main",
          provider: ISSUE_PROVIDER.GITHUB,
          channels: [{
            channelId: "g1",
            channel: NOTIFICATION_CHANNEL.TELEGRAM,
            name: "primary",
            accountId: "default",
          }],
          workers: {
            developer: {
              levels: {
                medior: [
                  { active: true, issueId: "5", sessionKey: "key-1", startTime: "2026-01-01T00:00:00Z" },
                  { active: false, issueId: null, sessionKey: null, startTime: null },
                ],
              },
            },
          },
        },
      },
    };

    await fs.writeFile(path.join(dataDir, "projects.json"), JSON.stringify(projectFirstData), "utf-8");

    await assert.rejects(() => readProjects(tmpDir), /Cannot read projects registry.*(groupName|issueId)/s);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("rejects non-canonical slugs and registry-key mismatches", () => {
    const traversalFixture = projectsFixture({
      channelId: "chat-1",
      channel: NOTIFICATION_CHANNEL.TELEGRAM,
      name: "primary",
      accountId: "dev",
    });

    if (!isObjectRecord(traversalFixture) || !isObjectRecord(traversalFixture.projects)) {
      throw new Error("Invalid traversal fixture.");
    }
    const project = traversalFixture.projects.devclaw;

    if (!isObjectRecord(project)) throw new Error("Invalid traversal project fixture.");
    project.slug = "../devclaw";
    assert.throws(() => parseProjectsData(traversalFixture), /lowercase kebab-case/);

    project.slug = "other-project";
    assert.throws(() => parseProjectsData(traversalFixture), /must match registry key/);
  });

});

/**
 * Build a valid current projects-registry fixture around one notification endpoint.
 *
 * @param channel - Notification endpoint assigned to the fixture project.
 */
function projectsFixture(channel: ProjectFixtureChannel): unknown {
  return {
    projects: {
      devclaw: {
        slug: "devclaw",
        name: "devclaw",
        agentId: "dev-agent",
        repo: "D:/web/devclaw",
        baseBranch: "main",
        deployBranch: "main",
        provider: ISSUE_PROVIDER.GITHUB,
        channels: [channel],
        workers: {},
      },
    },
  };
}

/**
 * Narrow an unknown fixture fragment to a mutable object record.
 *
 * @param value - Fixture fragment to inspect before a deliberate invalid mutation.
 */
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("per-level slot helpers", () => {
  it("findFreeSlot returns lowest inactive slot within a level", () => {
    const rw: RoleWorkerState = {
      levels: {
        medior: [
          { active: true, issueId: 1, sessionKey: null, startTime: null },
          { active: false, issueId: null, sessionKey: null, startTime: null },
          { active: false, issueId: null, sessionKey: null, startTime: null },
        ],
      },
    };

    assert.strictEqual(findFreeSlot(rw, "medior"), 1);
  });

  it("findFreeSlot returns null when all active in the level", () => {
    const rw: RoleWorkerState = {
      levels: {
        medior: [{ active: true, issueId: 1, sessionKey: null, startTime: null }],
      },
    };

    assert.strictEqual(findFreeSlot(rw, "medior"), null);
  });

  it("findFreeSlot returns null for non-existent level", () => {
    const rw: RoleWorkerState = { levels: {} };

    assert.strictEqual(findFreeSlot(rw, "senior"), null);
  });

  it("findSlotByIssue returns correct level and index", () => {
    const rw: RoleWorkerState = {
      levels: {
        medior: [
          { active: true, issueId: 10, sessionKey: null, startTime: null },
        ],
        junior: [
          { active: true, issueId: 20, sessionKey: null, startTime: null },
        ],
      },
    };
    const result = findSlotByIssue(rw, 20);

    assert.deepStrictEqual(result, { level: "junior", slotIndex: 0 });
    assert.strictEqual(findSlotByIssue(rw, 99), null);
  });

  it("countActiveSlots counts across all levels", () => {
    const rw: RoleWorkerState = {
      levels: {
        medior: [
          { active: true, issueId: 1, sessionKey: null, startTime: null },
          { active: false, issueId: null, sessionKey: null, startTime: null },
        ],
        junior: [
          { active: true, issueId: 3, sessionKey: null, startTime: null },
        ],
      },
    };

    assert.strictEqual(countActiveSlots(rw), 2);
  });
});

describe("projects repository round-trip", () => {
  it("should preserve per-level workers through write/read cycle", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-proj-"));
    const dataDir = path.join(tmpDir, "devclaw");

    await fs.mkdir(dataDir, { recursive: true });

    const data: ProjectsData = {
      projects: {
        "roundtrip": {
          slug: "roundtrip",
          name: "roundtrip",
          agentId: "test-agent",
          repo: "~/git/rt",
          baseBranch: "main",
          deployBranch: "main",
          provider: ISSUE_PROVIDER.GITHUB,
      channels: [{
        channelId: "g1",
        channel: NOTIFICATION_CHANNEL.TELEGRAM,
        name: "primary",
        accountId: "default",
      }],
          workers: {
            developer: emptyRoleWorkerState({ medior: 2 }),
            tester: emptyRoleWorkerState({ medior: 1 }),
            architect: emptyRoleWorkerState({ senior: 1 }),
          },
        },
      },
    };

    await writeProjectsFixture(tmpDir, data);
    const loaded = await readProjects(tmpDir);
    const project = loaded.projects.roundtrip;

    assert.ok(project.workers.developer);
    assert.ok(project.workers.developer.levels.medior);
    assert.strictEqual(project.workers.developer.levels.medior.length, 2);
    assert.strictEqual(project.workers.developer.levels.medior[0]!.active, false);
    assert.strictEqual(project.workers.developer.levels.medior[1]!.active, false);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("rejects activation and deactivation when a slot belongs to another issue", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-proj-ownership-"));
    const initial = parseProjectsData(projectsFixture({
      channelId: "g1",
      channel: NOTIFICATION_CHANNEL.TELEGRAM,
      name: "primary",
      accountId: "default",
    }));

    initial.projects.devclaw!.workers.developer = emptyRoleWorkerState({ medior: 1 });
    await writeProjectsFixture(tmpDir, initial);
    await activateWorker(tmpDir, "devclaw", "developer", {
      issueId: 101,
      level: "medior",
      slotIndex: 0,
    });

    await assert.rejects(
      activateWorker(tmpDir, "devclaw", "developer", {
        issueId: 102,
        level: "medior",
        slotIndex: 0,
      }),
      /already assigned to issue #101/,
    );
    await assert.rejects(
      deactivateWorker(tmpDir, "devclaw", "developer", {
        issueId: 102,
        level: "medior",
        slotIndex: 0,
      }),
      /belongs to issue #101, not #102/,
    );
    assert.equal(
      (await readProjects(tmpDir)).projects.devclaw!.workers.developer!.levels.medior![0]!.issueId,
      101,
    );
    await fs.rm(tmpDir, { recursive: true });
  });

  it("allows first-slot creation and idempotent activation by the same issue", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-proj-idempotent-"));
    const initial = parseProjectsData(projectsFixture({
      channelId: "g1",
      channel: NOTIFICATION_CHANNEL.TELEGRAM,
      name: "primary",
      accountId: "default",
    }));

    const project = initial.projects.devclaw;

    assert.ok(project);
    project.workers.developer = emptyRoleWorkerState({});
    await writeProjectsFixture(tmpDir, initial);
    await activateWorker(tmpDir, "devclaw", "developer", {
      issueId: 101,
      level: "medior",
      sessionKey: "first-session",
    });
    await activateWorker(tmpDir, "devclaw", "developer", {
      issueId: 101,
      level: "medior",
      sessionKey: "replacement-session",
    });

    const loadedProject = (await readProjects(tmpDir)).projects.devclaw;
    const worker = loadedProject?.workers.developer;
    const slot = worker?.levels.medior?.[0];

    assert.ok(slot);
    assert.equal(slot.issueId, 101);
    assert.equal(slot.sessionKey, "replacement-session");
    await fs.rm(tmpDir, { recursive: true });
  });

  it("serializes concurrent immutable updates without losing either change", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-proj-concurrency-"));
    const initial = parseProjectsData(projectsFixture({
      channelId: "g1",
      channel: NOTIFICATION_CHANNEL.TELEGRAM,
      name: "primary",
      accountId: "default",
    }));

    await fs.mkdir(path.join(tmpDir, "devclaw"), { recursive: true });
    await writeProjectsFixture(tmpDir, initial);
    await Promise.all(["first", "second"].map((name) => updateProjects(tmpDir, (current) => {
      const data = structuredClone(current);

      data.projects.devclaw!.channels.push({
        channelId: name,
        channel: NOTIFICATION_CHANNEL.TELEGRAM,
        name,
        accountId: "default",
      });

      return { data, result: undefined };
    })));

    const channels = (await readProjects(tmpDir)).projects.devclaw!.channels.map((channel) => channel.channelId);

    assert.deepStrictEqual([...channels].sort(), ["first", "g1", "second"]);
    await fs.rm(tmpDir, { recursive: true });
  });

  it("does not persist a candidate mutated before a callback failure", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-proj-failure-"));
    const initial = parseProjectsData(projectsFixture({
      channelId: "g1",
      channel: NOTIFICATION_CHANNEL.TELEGRAM,
      name: "primary",
      accountId: "default",
    }));

    await fs.mkdir(path.join(tmpDir, "devclaw"), { recursive: true });
    await writeProjectsFixture(tmpDir, initial);
    await assert.rejects(() => updateProjects(tmpDir, (current) => {
      const data = structuredClone(current);

      data.projects.devclaw!.name = "not-persisted";
      throw new Error("callback failed");
    }), /callback failed/);
    assert.equal((await readProjects(tmpDir)).projects.devclaw!.name, "devclaw");
    await fs.rm(tmpDir, { recursive: true });
  });
});

describe("reconcileSlots", () => {
  it("should expand slots when config increases maxWorkers for a level", () => {
    const rw: RoleWorkerState = {
      levels: { medior: [emptySlot()] },
    };
    const changed = reconcileSlots(rw, { medior: 3 });
    const slots = rw.levels.medior;

    assert.strictEqual(changed, true);
    assert.ok(slots);
    assert.strictEqual(slots.length, 3);
    assert.strictEqual(slots[1]!.active, false);
    assert.strictEqual(slots[2]!.active, false);
  });

  it("should shrink idle slots when config decreases maxWorkers", () => {
    const rw: RoleWorkerState = {
      levels: { medior: [emptySlot(), emptySlot(), emptySlot()] },
    };
    const changed = reconcileSlots(rw, { medior: 1 });
    const slots = rw.levels.medior;

    assert.strictEqual(changed, true);
    assert.ok(slots);
    assert.strictEqual(slots.length, 1);
  });

  it("should not remove active slots when shrinking", () => {
    const rw: RoleWorkerState = {
      levels: {
        medior: [
          { active: true, issueId: 1, sessionKey: null, startTime: null },
          { active: false, issueId: null, sessionKey: null, startTime: null },
          { active: true, issueId: 3, sessionKey: null, startTime: null },
        ],
      },
    };
    // Config says 1, but last slot (index 2) is active — shrinking stops immediately
    const changed = reconcileSlots(rw, { medior: 1 });
    const slots = rw.levels.medior;

    assert.strictEqual(changed, false);
    assert.ok(slots);
    assert.strictEqual(slots.length, 3);
  });

  it("should remove trailing idle slots but stop at active ones", () => {
    const rw: RoleWorkerState = {
      levels: {
        medior: [
          { active: true, issueId: 1, sessionKey: null, startTime: null },
          { active: true, issueId: 2, sessionKey: null, startTime: null },
          { active: false, issueId: null, sessionKey: null, startTime: null },
        ],
      },
    };
    // Config says 1, last slot (index 2) is idle → removed, then slot 1 is active → stop
    const changed = reconcileSlots(rw, { medior: 1 });
    const slots = rw.levels.medior;

    assert.strictEqual(changed, true);
    assert.ok(slots);
    assert.strictEqual(slots.length, 2);
  });

  it("should not change when slots match config", () => {
    const rw: RoleWorkerState = {
      levels: { medior: [emptySlot(), emptySlot()] },
    };
    const changed = reconcileSlots(rw, { medior: 2 });
    const slots = rw.levels.medior;

    assert.strictEqual(changed, false);
    assert.ok(slots);
    assert.strictEqual(slots.length, 2);
  });

  it("should create new level arrays for levels in config but not in state", () => {
    const rw: RoleWorkerState = { levels: {} };
    const changed = reconcileSlots(rw, { medior: 2, senior: 1 });
    const mediorSlots = rw.levels.medior;
    const seniorSlots = rw.levels.senior;

    assert.strictEqual(changed, true);
    assert.ok(mediorSlots);
    assert.ok(seniorSlots);
    assert.strictEqual(mediorSlots.length, 2);
    assert.strictEqual(seniorSlots.length, 1);
  });
});
