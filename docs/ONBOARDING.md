# DevClaw — Onboarding Guide

Step-by-step setup: install the plugin, configure an agent, register projects, and run your first task.

## Prerequisites

| Requirement | Why | How to check |
|---|---|---|
| [OpenClaw](https://openclaw.ai) installed | DevClaw is an OpenClaw plugin | `openclaw --version` |
| Node.js >= 20 | Runtime for plugin | `node --version` |
| [`gh`](https://cli.github.com) or [`glab`](https://gitlab.com/gitlab-org/cli) CLI | Issue tracker provider (auto-detected from git remote) | `gh --version` or `glab --version` |
| CLI authenticated | Plugin calls gh/glab for every label transition | `gh auth status` or `glab auth status` |
| A GitHub/GitLab repo with issues | The task backlog lives in the issue tracker | `gh issue list` or `glab issue list` from your repo |

## Step 1: Install the plugin

```bash
openclaw plugins install @laurentenhoor/devclaw
```

Or for local development:
```bash
openclaw plugins install -l ./devclaw
```

Verify:
```bash
openclaw plugins list
# Should show: DevClaw | devclaw | loaded
```

## Step 2: Run setup

There are three ways to set up DevClaw:

### Option A: Conversational onboarding (recommended)

Call the `onboard` tool from any agent that has the DevClaw plugin loaded. The agent walks you through configuration step by step — asking about:
- Agent selection (current or create new)
- Channel endpoint binding (for example `telegram/dev`, `telegram/dev/-100123`, `telegram/dev/-100123:topic:331`, or none)
- Model levels (accept defaults or customize)
- Optional project registration

The tool returns instructions that guide the agent through the QA-style setup conversation.

### Option B: CLI wizard

```bash
openclaw devclaw setup
```

The setup wizard walks you through:

1. **Agent** — Create a new orchestrator agent or configure an existing one
2. **Channel** — Create a binding for an existing OpenClaw channel account, group, or topic; or skip channel setup
3. **Developer team** — Choose which LLM model powers each level:
   - **Developer junior** (fast, cheap tasks) — default: `anthropic/claude-haiku-4-5`
   - **Developer medior** (standard tasks) — default: `anthropic/claude-sonnet-4-5`
   - **Developer senior** (complex tasks) — default: `anthropic/claude-opus-4-6`
   - **Tester junior** (quick checks) — default: `anthropic/claude-haiku-4-5`
   - **Tester medior** (standard review) — default: `anthropic/claude-sonnet-4-5`
   - **Tester senior** (thorough review) — default: `anthropic/claude-opus-4-6`
   - **Architect junior** (standard design) — default: `anthropic/claude-sonnet-4-5`
   - **Architect senior** (complex architecture) — default: `anthropic/claude-opus-4-6`
4. **Workspace** — Writes AGENTS.md, HEARTBEAT.md, workflow.yaml, role templates, and initializes state

Non-interactive mode:
```bash
# Create new agent with default models
openclaw devclaw setup --new-agent "My Dev Orchestrator"

# Create new agent bound to a specific Telegram topic on the dev account
openclaw devclaw setup --new-agent "Topic Agent" \
  --channel-binding telegram \
  --channel-account-id dev \
  --channel-peer-id "-1003911014709:topic:331"

# Configure existing agent with custom models
openclaw devclaw setup --agent my-orchestrator \
  --developer-junior "anthropic/claude-haiku-4-5" \
  --developer-senior "anthropic/claude-opus-4-6" \
  --tester-senior "anthropic/claude-opus-4-6"
```

### Option C: Tool call (agent-driven)

**Conversational onboarding via tool:**
```json
onboard({ "mode": "first-run" })
```

The tool returns step-by-step instructions that guide the agent through the setup conversation.

**Direct setup (skip conversation):**
```json
setup({
  "newAgentName": "My Dev Orchestrator",
  "channelBinding": "telegram",
  "channelAccountId": "dev",
  "channelPeerId": "-1003911014709:topic:331",
  "models": {
    "developer": {
      "junior": "anthropic/claude-haiku-4-5",
      "senior": "anthropic/claude-opus-4-6"
    },
    "tester": {
      "medior": "anthropic/claude-sonnet-4-5"
    }
  }
})
```

## Step 3: Channel binding (optional)

If you selected a channel binding during setup, the agent is automatically bound. **Skip to step 4.**

Setup writes only `bindings[]`. OpenClaw channel accounts, bot tokens, group allowlists, and topic allowlists must already exist in OpenClaw config.

If you didn't bind a channel during setup:

**Option A: Manually edit `openclaw.json`**

```json
{
  "bindings": [
    {
      "agentId": "my-orchestrator",
      "match": {
        "channel": "telegram",
        "accountId": "dev",
        "peer": {
          "kind": "group",
          "id": "-1003911014709:topic:331"
        }
      }
    }
  ]
}
```

Setup creates only exact bindings with explicit `channelAccountId` and `channelPeerId`. The resulting OpenClaw binding looks like:
```json
{
  "agentId": "my-orchestrator",
  "match": {
    "channel": "telegram",
    "accountId": "dev",
    "peer": {
      "kind": "group",
      "id": "-1003911014709:topic:331"
    }
  }
}
```

Restart OpenClaw after editing.

**Option B: Add bot to Telegram/WhatsApp group**

Add the selected account's bot to the exact group or topic represented by the binding.

## Step 4: Register your project

Go to the Telegram/WhatsApp group for the project and tell the orchestrator agent:

> "Register project my-project at ~/git/my-project with base branch development"

The agent calls `project_register`, which atomically:
- Validates the repo and auto-detects GitHub/GitLab from remote
- Creates all state labels (idempotent)
- Scaffolds role instruction files (`devclaw/projects/<project>/prompts/developer.md`, `tester.md`, `architect.md`)
- Adds the project entry to `projects.json`
- Logs the registration event

**Initial state in `projects.json`:**

```json
{
  "projects": {
    "my-project": {
      "slug": "my-project",
      "agentId": "my-orchestrator",
      "name": "my-project",
      "repo": "~/git/my-project",
      "groupName": "Project: my-project",
      "baseBranch": "development",
      "deployBranch": "development",
      "provider": "github",
      "channels": [
        {
          "channelId": "-1234567890",
          "channel": "telegram",
          "name": "primary",
          "events": ["*"]
        }
      ],
      "workers": {
        "developer": {
          "levels": {
            "junior": [],
            "medior": [],
            "senior": []
          }
        },
        "tester": {
          "levels": {
            "junior": [],
            "medior": [],
            "senior": []
          }
        },
        "architect": {
          "levels": {
            "junior": [],
            "senior": []
          }
        }
      }
    }
  }
}
```

**Finding the Telegram group ID:** The group ID is the numeric ID of your Telegram supergroup (a negative number like `-1234567890`). It is stored as the project's `channelId`. When you call `project_register` from within the group, the ID is auto-detected from context.

## Step 5: Create your first issue

Issues can be created in multiple ways:
- **Via the agent** — Ask the orchestrator in the Telegram group: "Create an issue for adding a login page" (uses `task_create`)
- **Via workers** — DEVELOPER/TESTER workers can call `task_create` to file follow-up bugs they discover
- **Via CLI** — prefer DevClaw CLI/tools so `issues.json` is initialized; raw `gh issue create` needs explicit backfill before managed dispatch
- **Via web UI** — create the provider issue only when you plan to backfill it into DevClaw local state

Note: `task_create` creates a managed issue in the configured initial state, normally "Planning". Call `task_start` to release it into "To Do". Provider-only issues created outside DevClaw are not normal dispatch candidates until they have local issue state.

## Step 6: Test the pipeline

Ask the agent in the Telegram group:

> "Check the queue status"

The agent should call `tasks_status` and report the "Planning" issue. Then:

> "Pick up issue #1 for developer"

The agent calls `task_start`, which advances the issue to the queue. The heartbeat dispatches a worker on its next cycle — it assigns a level, transitions the label to "Doing", creates or reuses a worker session, and dispatches the task. The agent posts the announcement.

## Step 7: Understand the workflow

Your workflow is set up with **human review** and **no test phase** by default:

```
Planning → To Do → Doing → To Review → PR approved → Done (auto-merge + close)
```

You can customize this at any time:
- **Review policy**: Change to `agent` (AI reviewer) or `skip` in `workflow.yaml`
- **Test phase**: Enable automated QA after review — see [Workflow](WORKFLOW.md#test-phase-optional)
- **Per-project overrides**: Create a project-specific `workflow.yaml` — see [Configuration](CONFIGURATION.md#three-layer-config-resolution)

Ask the orchestrator "change the review policy" or "enable the test phase" and it will walk you through it using the `workflow_guide` tool.

## Adding more projects

Tell the agent to register a new project (step 4) from within the new project's Telegram group. That's it — `project_register` handles labels and state setup.

Each project is fully isolated — separate queue, separate workers, separate state.

## Developer levels

DevClaw assigns tasks to developer levels instead of raw model names. This makes the system intuitive — you're assigning a "junior" to fix a typo, not configuring model parameters. All roles use the same level scheme.

| Role | Level | Default Model | When to assign |
|------|-------|---------------|----------------|
| Developer | **junior** | `anthropic/claude-haiku-4-5` | Typos, single-file fixes, CSS changes |
| Developer | **medior** | `anthropic/claude-sonnet-4-5` | Features, bug fixes, multi-file changes |
| Developer | **senior** | `anthropic/claude-opus-4-6` | Architecture, migrations, system-wide refactoring |
| Tester | **junior** | `anthropic/claude-haiku-4-5` | Quick smoke tests, basic checks |
| Tester | **medior** | `anthropic/claude-sonnet-4-5` | Standard code review, test validation |
| Tester | **senior** | `anthropic/claude-opus-4-6` | Thorough security review, complex edge cases |
| Architect | **junior** | `anthropic/claude-sonnet-4-5` | Standard design investigation |
| Architect | **senior** | `anthropic/claude-opus-4-6` | Complex architecture decisions |

Change which model powers each level in `workflow.yaml` — see [Configuration](CONFIGURATION.md#role-configuration).

## What the plugin handles vs. what you handle

| Responsibility | Who | Details |
|---|---|---|
| Plugin installation | You (once) | `openclaw plugins install @laurentenhoor/devclaw` |
| Agent + workspace setup | Plugin (`setup`) | Creates agent, configures models, writes workspace files |
| Exact channel binding | Plugin (`setup`) | Creates an explicit account + peer binding for the selected agent |
| Label setup | Plugin (`project_register`) | State labels, created idempotently via IssueProvider |
| Prompt file scaffolding | Plugin (`project_register`) | Creates `devclaw/projects/<project>/prompts/<role>.md` for each role |
| Project registration | Plugin (`project_register`) | Entry in `projects.json` with empty worker state |
| Telegram group setup | You (once per project) | Add bot to group |
| Issue creation | Plugin (`task_create`) | Orchestrator or workers create issues from chat |
| Label transitions | Plugin | Atomic transitions via issue tracker CLI |
| Developer assignment | Plugin | LLM-selected level by orchestrator, keyword heuristic fallback |
| State management | Plugin | Atomic read/write to `projects.json` with file locking |
| Session management | Plugin | Creates, reuses, and dispatches to sessions via CLI. Agent never touches session tools. |
| Task completion | Plugin (`work_finish`) | Workers self-report. Scheduler dispatches next role. |
| Role instructions | Plugin (bootstrap hook) | Injected into worker sessions via `agent:bootstrap` hook at session startup |
| Review polling | Plugin (heartbeat) | Auto-merges and advances "To Review" issues when PR is approved |
| Config validation | Plugin | Zod schemas validate `workflow.yaml` at load time |
| Audit logging | Plugin | Automatic NDJSON append per tool call |
| Zombie detection | Plugin | `health` checks active vs alive |
| Queue scanning | Plugin | `tasks_status` queries issue tracker per project |
