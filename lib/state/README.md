# State Layer

Filesystem stores, migrations, locking, and serialization.

Rules:

- May import `domain`.
- Must not import `tools` or `cli`.
- Runtime persistence stays explicit and recoverable.

