/** Renders conversational setup instructions without workspace or configuration I/O. */

import { NOTIFICATION_CHANNEL } from "../../../domain/index.js";
import { getAllBuiltInDefaultModels } from "../../../roles/index.js";
import type { ModelConfig } from "../types.js";

/** Render role-level model assignments for onboarding guidance.
 * @param models - Explicit assignments or built-in defaults for a new workspace.
 */
function buildModelTable(models: ModelConfig = getAllBuiltInDefaultModels()): string {
  const lines: string[] = [];

  for (const [role, levels] of Object.entries(models)) {
    for (const [level, model] of Object.entries(levels)) {
      lines.push(`  - **${role} ${level}**: ${model}`);
    }
  }

  return lines.join("\n");
}

/** Describe explicit configuration operations for an existing workspace.
 * @param models - Effective workspace assignments, including custom roles and levels.
 */
export function buildReconfigContext(models: ModelConfig): string {
  const modelTable = buildModelTable(models);

  return `# DevClaw Reconfiguration

The user wants to reconfigure DevClaw. Current workspace model configuration:

${modelTable}

Models are configured in \`devclaw/workflow.yaml\`. Edit that file directly or call \`setup\` with a \`models\` object to update.

## What can be changed
1. **Model levels** — call \`setup\` with a \`models\` object containing only the levels to change
2. **Workspace files** — ordinary \`setup\` creates missing files; use \`refreshInstructions: true\` to replace instructions with backups
3. **Register new projects** — use \`project_register\`

Ask what they want to change, then call the appropriate tool.
Ordinary \`setup\` preserves existing files. Explicit refresh/reset operations create backups before replacing files.
`;
}

/** Describe the first-run conversational setup procedure. */
export function buildOnboardToolContext(): string {
  return `# DevClaw Onboarding

## What is DevClaw?
DevClaw turns each Telegram group into an autonomous development team:
- An **orchestrator** that manages backlogs and delegates work
- **Developer workers** (junior/medior/senior levels) that write code in isolated sessions
- **Tester workers** that review code and run tests
- Atomic tools for label transitions, session dispatch, state management, and audit logging

## Setup Steps

**Step 1: Agent Selection**
Ask: "Do you want to configure DevClaw for the current agent, or create a new dedicated agent?"
- Current agent → collect its exact \`agentId\` or \`workspacePath\` for setup
- New agent → ask for agent name
- Selected/new agent → ask for:
  1. **Channel setup**: "Bind this agent to an existing channel account? (telegram/default, telegram/dev, whatsapp/default, none)"
     - List configured channel accounts and exact groups/topics from openclaw.json; do not ask for tokens
     - If a channel account is selected:
       a) Require an exact group, chat, or topic peer
       b) If channel not configured/enabled → warn and recommend skipping binding for now
       c) Reject the route if that exact account/peer is bound to another agent
     - If none selected, user can add bindings manually later via openclaw.json

**Step 2: Model Configuration**

Built-in model defaults for a new workspace:
${buildModelTable()}

1. For an existing workspace, read its effective role-level configuration; preserve existing assignments.
2. Present the assignments and ask whether to keep them or change specific role levels.
3. Collect an explicit model ID for each requested role-level change.
4. Pass only those changes through \`setup.models\`; omit \`models\` when keeping current settings or accepting defaults.
5. Define new roles and levels in \`devclaw/workflow.yaml\` first, including rank, model, defaultLevel, and completion mappings.
   Custom roles also need a prompt and workflow queue/active states.

Model authentication is configured separately in OpenClaw. Setup does not invoke an LLM to choose models or require a model-discovery command.

**Step 3: Run Setup**
Call \`setup\` with the collected answers:
` +
      `- Current agent: \`setup({ agentId: "<agentId>", channelBinding: "${NOTIFICATION_CHANNEL.TELEGRAM}"|"${NOTIFICATION_CHANNEL.WHATSAPP}"|null, ` +
      `channelAccountId: "<accountId>"|null, ` +
      `channelPeerId: "<groupId[:topic:topicId]>"|null, ` +
    `models: { developer: { ... }, tester: { ... } } })\`
` +
      `- New agent: \`setup({ newAgentName: "<name>", channelBinding: "${NOTIFICATION_CHANNEL.TELEGRAM}"|"${NOTIFICATION_CHANNEL.WHATSAPP}"|null, ` +
    `channelAccountId: "<accountId>"|null, channelPeerId: "<groupId[:topic:topicId]>"|null, ` +
    `models: { ... } })\`
` +
    `  - \`channelAccountId\` and \`channelPeerId\` are both required when a channel binding is selected.
- Setup writes only route bindings; OpenClaw remains responsible for channel account configuration.

**Step 4: Telegram Group Setup (IMPORTANT)**
After setup completes, explain project isolation best practices:

📱 **Telegram Group Guidance:**
DevClaw uses **one Telegram group per project** for isolation and clean backlogs.

**Recommended Setup:**
1. **Create a new Telegram group** for each project
2. **Add your bot** to the group
3. **Use mentions** to interact: "@botname status", "@botname pick up #42"
4. Each group gets its own queue, workers, and audit log

**Why separate groups?**
- Clean issue backlogs per project
- Isolated worker state (no cross-project confusion)
- Clear audit trails
- Team-specific access control

Each exact account/group/topic destination belongs to one project. Use separate topics or groups for separate projects.

**Step 5: Project Registration**
Explain that projects should be registered **from within their Telegram group**:

📌 **How to register a project:**
1. Create a Telegram group for the project
2. Add the bot to the group
3. In that group, tell the bot: "Register this project" (or use \`project_register\`)
4. The bot will auto-detect the group ID from the conversation context

This keeps each project's registration tied to its group from the start.

` +
    `You can also register a project from this admin session if you want, but it's better to keep this session ` +
    `free for general admin tasks. If they want to register here anyway, collect: project name, repo path, ` +
    `Telegram group ID, group name, base branch, then call \`project_register\`.

**Step 6: Workflow Overview**
After project registration, briefly tell the user about their active workflow:

` +
    `- **Review policy**: human (default) — PRs need human approval on GitHub/GitLab, heartbeat auto-merges when approved.
` +
    `- **Test phase**: skipped by default — the testing step is in the workflow but issues bypass it automatically. ` +
    `Use an explicit DevClaw policy migration for existing managed issues; editing provider labels does not change their authoritative state. ` +
    `To enable globally, set \`testPolicy: agent\` in workflow.yaml.
` +
    `- **Customization**: They can change the review policy (human/agent/auto), enable testing (testPolicy: agent), ` +
    `or override settings per project. Point them to \`workflow.yaml\` in the devclaw data directory.
` +
    `- Say: "Your workflow is set up with **human review** and **testing skipped** by default. ` +
    `Set \`testPolicy: agent\` in workflow.yaml for new issues and use \`issue_policy_migrate\` for existing managed issues."

## Guidelines
- Be conversational and friendly. Ask one question at a time.
- Show defaults so the user can accept them quickly.
- After setup, summarize what was configured (including channel binding if applicable).
`;
}
