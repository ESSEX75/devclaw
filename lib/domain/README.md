# Domain Layer

Pure domain types, identifiers, policies, and workflow semantics.

Rules:

- No filesystem, network, OpenClaw runtime, CLI, or tool-context imports.
- No imports from `application`, `state`, `integrations`, `tools`, or `cli`.
- May be imported by any other layer.

