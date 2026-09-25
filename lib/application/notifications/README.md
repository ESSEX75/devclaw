# Notifications

This application capability delivers worker and pipeline lifecycle messages through exact project routes.

`types.ts` owns event, receipt, route, and runtime contracts. `render.ts` creates messages without I/O. `resolve-endpoint.ts` reads the notification binding from authoritative local issue state and resolves only its matching project endpoint. `notify.ts` validates the route and coordinates one delivery attempt. `delivery.ts` tries the runtime sender, then the command fallback if needed; a successful runtime send never invokes fallback. `audit.ts` maps typed decisions and delivery outcomes to audit records. `retry-pipeline.ts` retries expired durable terminal notification attempts and confirms successful delivery before archival.

Unknown bindings and invalid routes do not redirect to another endpoint. Terminal notification retries continue to use the state-owned attempt lease and confirmation APIs.
