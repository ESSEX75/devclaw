# Testing Package

This package owns reusable test harnesses, fakes, and test-only helpers for DevClaw.

## Boundary Rules

- Keep production behavior out of this package.
- Model external capabilities with deterministic fakes rather than network or provider calls.
- Reuse public production contracts and avoid creating divergent test-only domain models.
- Keep narrowly scoped fixtures beside their owning tests when they are not shared.

Run the affected focused tests and the full suite after changing shared test infrastructure.
