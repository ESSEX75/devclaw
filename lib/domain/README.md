# Domain Layer

Pure domain types, identifiers, policies, and workflow semantics.

Initial entrypoints:

- `ids.ts` — project, channel, issue, workflow, role, level, session, and provider ID aliases.
- `issue.ts` — issue runtime state domain types.

Rules:

- No filesystem, network, OpenClaw runtime, CLI, or tool-context imports.
- No imports from `application`, `state`, `integrations`, `tools`, or `cli`.
- May be imported by any other layer.
