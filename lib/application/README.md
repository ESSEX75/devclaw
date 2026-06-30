# Application Layer

Use cases and orchestration over domain, state, and integration capabilities.

Rules:

- May import `domain`, state interfaces/stores, and integration capability interfaces.
- Must not import OpenClaw tool context or CLI command adapters.
- Tools and CLI should call application use cases, not the other way around.

