# Managed Queue

The queue selects initialized managed issues from local runtime state and coordinates dispatch. `select.ts` filters healthy, unowned, locally queued candidates in stable issue order without I/O. `scan.ts` checks creation readiness and reads the provider issue for message context; provider labels do not choose the runtime workflow state. `plan.ts` selects the configured role level and free slot from a fresh snapshot. `tick.ts` scans, acquires the issue lock, repeats the scan and project-slot checks, then calls the workers dispatch command. It does not send OpenClaw session messages or persist worker ownership itself.

Concurrent ticks recheck after waiting for the issue lock. The worker command reserves a concrete slot atomically, and only one issue can own it. A dry-run returns the selected candidate and slot plan without effects.
