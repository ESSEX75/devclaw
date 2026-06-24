/**
 * Tests for provider-level sprint projection contract.
 *
 * Run: npx tsx --test lib/providers/sprint-projection.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { TestProvider } from "../testing/test-provider.js";
import { GitHubProvider } from "./github.js";
import { GitLabProvider } from "./gitlab.js";
import type { RunCommand } from "../context.js";

describe("sprint projection provider contract", () => {
  it("test provider models milestone, root, child issues, dependencies, branches, and PR links", async () => {
    const provider = new TestProvider();

    const milestone = await provider.createSprintMilestone({
      title: "sprint-100-devclaw-sprint-mode",
      description: "Sprint delivery unit",
    });
    const root = await provider.createSprintRoot({
      title: "DevClaw sprint mode",
      body: "Root scope",
      milestoneId: milestone.id,
    });
    const child = await provider.createChildIssue({
      title: "Provider abstraction",
      body: "Implement provider contract",
      milestoneId: milestone.id,
    });
    await provider.linkChildIssue({ rootIssueId: root.iid, childIssueId: child.iid });
    await provider.linkIssueDependency({ blockedIssueId: child.iid, blockingIssueId: root.iid });
    await provider.assignIssue({ issueId: child.iid, assignees: ["egor"] });
    const sprintBranch = await provider.createSprintBranch({
      branch: "sprint/100-devclaw-sprint-mode",
      fromBranch: "main",
    });
    const workBranch = await provider.createWorkBranch({
      branch: "step/101-provider-abstraction",
      fromBranch: sprintBranch.name,
    });
    const pr = await provider.createPullRequest({
      title: "feat: provider abstraction",
      body: "Refs child issue",
      sourceBranch: workBranch.name,
      targetBranch: sprintBranch.name,
      issueId: child.iid,
    });
    await provider.linkPullRequestToIssue({
      issueId: child.iid,
      pullRequestId: pr.id,
      pullRequestUrl: pr.url,
    });
    const tree = await provider.readSprintTree({ rootIssueId: root.iid });
    const dependencies = await provider.readDependencies({ issueIds: [root.iid, child.iid] });

    assert.strictEqual(tree.milestone?.id, milestone.id);
    assert.strictEqual(tree.rootIssue.iid, root.iid);
    assert.deepStrictEqual(tree.childIssues.map((issue) => issue.iid), [child.iid]);
    assert.deepStrictEqual(dependencies, [{
      blockingIssueId: root.iid,
      blockedIssueId: child.iid,
      native: false,
    }]);
    assert.ok((provider.comments.get(root.iid) ?? []).some((comment) =>
      comment.body.includes(`#${root.iid} blocks #${child.iid}`),
    ));
    assert.ok((provider.comments.get(child.iid) ?? []).some((comment) =>
      comment.body.includes(`blocked by #${root.iid}`),
    ));
    assert.strictEqual(tree.pullRequests[0]?.targetBranch, sprintBranch.name);
    assert.strictEqual(provider.sprintBranches.get(sprintBranch.name)?.base, "main");
    assert.strictEqual(provider.sprintBranches.get(workBranch.name)?.base, sprintBranch.name);
  });

  it("test provider closes milestones and guards managed projection metadata", async () => {
    const provider = new TestProvider();
    const milestone = await provider.createSprintMilestone({ title: "sprint-1" });
    const root = await provider.createSprintRoot({ title: "root", body: "{}" });

    await provider.closeSprintMilestone({ milestoneId: milestone.id });
    provider.managedProjectionErrors = ["rootIssue.metadata"];

    const failed = await provider.guardManagedProjection({
      rootIssueId: root.iid,
      expectedMetadata: { sprint: 1 },
    });
    const repaired = await provider.guardManagedProjection({
      rootIssueId: root.iid,
      expectedMetadata: { sprint: 1 },
      repair: true,
    });

    assert.strictEqual(provider.sprintMilestones.get(milestone.id)?.closed, true);
    assert.deepStrictEqual(failed.integrityErrors, ["rootIssue.metadata"]);
    assert.deepStrictEqual(repaired.repaired, ["rootIssue.metadata"]);
    assert.deepStrictEqual(provider.managedProjectionErrors, []);
  });

  it("GitHub and GitLab providers expose the full sprint projection shape", () => {
    const runCommand = (async () => ({
      stdout: "{}",
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
      termination: null,
    })) as unknown as RunCommand;
    const github = new GitHubProvider({ repoPath: "/tmp/repo", runCommand });
    const gitlab = new GitLabProvider({ repoPath: "/tmp/repo", runCommand });

    for (const provider of [github, gitlab]) {
      assert.strictEqual(typeof provider.createSprintMilestone, "function");
      assert.strictEqual(typeof provider.createSprintRoot, "function");
      assert.strictEqual(typeof provider.createChildIssue, "function");
      assert.strictEqual(typeof provider.linkChildIssue, "function");
      assert.strictEqual(typeof provider.linkIssueDependency, "function");
      assert.strictEqual(typeof provider.assignIssue, "function");
      assert.strictEqual(typeof provider.createSprintBranch, "function");
      assert.strictEqual(typeof provider.createWorkBranch, "function");
      assert.strictEqual(typeof provider.createPullRequest, "function");
      assert.strictEqual(typeof provider.linkPullRequestToIssue, "function");
      assert.strictEqual(typeof provider.readSprintTree, "function");
      assert.strictEqual(typeof provider.readDependencies, "function");
      assert.strictEqual(typeof provider.closeSprintMilestone, "function");
      assert.strictEqual(typeof provider.guardManagedProjection, "function");
    }
  });

  it("GitHub provider writes native relationships and keeps comment fallback", async () => {
    const calls: string[][] = [];
    const runCommand = (async (cmd: string[]) => {
      calls.push(cmd);
      const args = cmd.slice(1);
      const path = args[1] ?? "";
      if (args[0] === "api" && path === "repos/:owner/:repo/issues/101") {
        return { stdout: "9001", stderr: "", code: 0, signal: null, killed: false, termination: null };
      }
      if (args[0] === "api" && path === "repos/:owner/:repo/issues/102") {
        return { stdout: "9002", stderr: "", code: 0, signal: null, killed: false, termination: null };
      }
      return { stdout: "{}", stderr: "", code: 0, signal: null, killed: false, termination: null };
    }) as unknown as RunCommand;
    const provider = new GitHubProvider({ repoPath: "/tmp/repo", runCommand });

    await provider.linkChildIssue({ rootIssueId: 100, childIssueId: 101 });
    await provider.linkIssueDependency({ blockedIssueId: 102, blockingIssueId: 101 });

    assert.ok(calls.some((cmd) =>
      cmd.includes("repos/:owner/:repo/issues/100/sub_issues")
      && cmd.includes("--field")
      && cmd.includes("sub_issue_id=9001")
    ));
    assert.ok(calls.some((cmd) =>
      cmd.includes("repos/:owner/:repo/issues/102/dependencies/blocked_by")
      && cmd.includes("--field")
      && cmd.includes("issue_id=9001")
    ));
    assert.ok(calls.some((cmd) =>
      cmd.includes("repos/:owner/:repo/issues/100/comments")
      && cmd.includes("body=DevClaw sprint projection: child issue #101")
    ));
    assert.ok(calls.some((cmd) =>
      cmd.includes("repos/:owner/:repo/issues/102/comments")
      && cmd.includes("body=DevClaw sprint projection: blocked by #101")
    ));
  });

  it("GitHub provider reads native dependency timeline events", async () => {
    const calls: string[][] = [];
    const runCommand = (async (cmd: string[]) => {
      calls.push(cmd);
      const args = cmd.slice(1);
      const path = args[1] ?? "";
      if (args[0] === "api" && path === "repos/:owner/:repo/issues/102/timeline") {
        return {
          stdout: JSON.stringify([
            { event: "blocked_by_added", issue: { number: 101 } },
          ]),
          stderr: "",
          code: 0,
          signal: null,
          killed: false,
          termination: null,
        };
      }
      if (args[0] === "api" && path === "repos/:owner/:repo/issues/101/timeline") {
        return { stdout: "[]", stderr: "", code: 0, signal: null, killed: false, termination: null };
      }
      if (args[0] === "api" && path.endsWith("/comments")) {
        return { stdout: "", stderr: "", code: 0, signal: null, killed: false, termination: null };
      }
      return { stdout: "{}", stderr: "", code: 0, signal: null, killed: false, termination: null };
    }) as unknown as RunCommand;
    const provider = new GitHubProvider({ repoPath: "/tmp/repo", runCommand });

    const dependencies = await provider.readDependencies({ issueIds: [101, 102] });

    assert.deepStrictEqual(dependencies, [{
      blockedIssueId: 102,
      blockingIssueId: 101,
      native: true,
    }]);
    assert.ok(calls.some((cmd) => cmd.includes("repos/:owner/:repo/issues/102/timeline")));
  });
});
