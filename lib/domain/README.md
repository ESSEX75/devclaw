# Domain Layer

This layer owns pure DevClaw semantics.

Domain modules define workflow types, role/project/issue concepts, labels,
policies, IDs, and deterministic helper functions. Code here should be safe to
execute without filesystem access, provider clients, OpenClaw runtime context, or
CLI state.

Package ownership is explicit: `notifications` owns messaging endpoints and
notification routing labels, `issues` owns provider IDs and issue ownership,
`projects` owns project and worker-slot structures, and `workflow` owns state
machine semantics and workflow routing.

## Boundary Rules

- Do not import from `lib/application`, `lib/state`, `lib/integrations`,
  `lib/tools`, or `lib/cli`.
- Do not perform IO.
- Do not know about GitHub, GitLab, OpenClaw sessions, or command-line parsing.
- Do not add migration or compatibility facades here.

If a function needs runtime state, provider data, or filesystem access, it belongs
outside `lib/domain`.
