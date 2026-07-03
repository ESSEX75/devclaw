# DevClaw — Roadmap

This page tracks supported product direction. Completed architecture migrations
and temporary refactor notes belong in release history or operator reports, not
in public docs.

## Current Foundation

- **Configurable workflow state machine** — issue states, transitions, review
  policy, test policy, and role execution are defined in `workflow.yaml`.
- **Managed issue runtime state** — `devclaw/projects/<project>/issues.json` is
  the runtime source of truth; provider labels and issue bodies are projections.
- **Role registry** — developer, tester, architect, and reviewer roles are
  configured through `lib/roles/registry.ts` and overridable workflow config.
- **Project/channel routing** — projects are keyed by slug and can be linked to
  one or more channels.
- **Provider abstraction** — GitHub and GitLab share the `IssueProvider`
  interface and resilience wrappers.

## Planned

- **Jira provider** — add a third provider implementation behind the existing
  `IssueProvider` interface.
- **Deployment integration** — allow workflow actions to trigger deployment
  commands or webhooks after review/test completion.
- **Cost and usage reporting** — record task-level model usage and expose it in
  project status views.
- **Priority scoring** — rank queued issues by labels, age, dependencies, and
  project policy.
- **Session archival** — archive or recreate idle worker sessions after a
  configurable timeout.
- **Progressive delegation** — track role/level pass rates and suggest safer
  model or level changes.
- **Custom workflow actions** — support user-defined actions in `workflow.yaml`
  for project-specific automation.
