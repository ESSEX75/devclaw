# Integrations Layer

Adapters for external systems such as GitHub, GitLab, OpenClaw, and gateway APIs.

Rules:

- Provider implementations belong here in the target structure.
- Capability interfaces should be consumed by application use cases.
- Old `lib/providers` can remain as a compatibility facade during migration.

