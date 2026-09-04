# Integrations Layer

This layer owns concrete external adapters.

Integration modules talk to external systems such as GitHub, GitLab, OpenClaw
gateway/session APIs, and provider-specific capabilities. They should expose
small adapter functions and typed results for application use cases.

## Boundary Rules

- Keep provider API details in `lib/integrations/providers`.
- Keep OpenClaw runtime and session details in `lib/integrations/openclaw`.
- Do not own workflow decisions here; place those in `lib/domain` or
  `lib/application`.
- Do not format OpenClaw tool responses here.

Use `npm run arch:check:strict` after changing this layer.
