# Command Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give browser, file-bridge, Tauri, CLI, and Agent calls one reliable command envelope and result contract.

**Architecture:** `tools/flovart/core.js` stays the only command registry. Transports claim and complete a shared envelope with explicit terminal states, leases, structured errors, and idempotency; adapters normalize transport details before returning results.

**Tech Stack:** JavaScript/TypeScript, Vite middleware, Rust/Tauri, SQLite sync log, Vitest, Rust unit tests.

---

### Task 1: Define The Command Envelope

**Files:**
- Create: `tools/flovart/command-envelope.js`
- Modify: `tools/flovart/core.js`
- Create: `tests/flovartCommandEnvelope.test.ts`

- [ ] Define statuses `queued`, `running`, `succeeded`, `failed`, and `expired` plus structured `{ code, message, details?, retryable? }` errors.
- [ ] Add pure `create`, `claim`, `complete`, `fail`, `expire`, and `requeueExpiredLease` helpers with timestamp and lease validation.
- [ ] Normalize CLI results so pending timeout is not `ok: true` completion.

### Task 2: Make The File Queue Atomic And Recoverable

**Files:**
- Modify: `tools/flovart/flovart-bridge.js`
- Create: `tests/flovartBridgeQueue.test.ts`

- [ ] Write queue state to a temporary sibling file and atomically rename it over the queue file.
- [ ] Claim with a lease deadline, recover only retryable expired entries, and retain bounded terminal entries.
- [ ] Serialize read-modify-write operations in-process and cover two concurrent enqueues without loss.
- [ ] Test crash-after-claim recovery, failure propagation, expiry, and timeout results.

### Task 3: Align Browser Polling

**Files:**
- Create: `services/flovartBrowserRuntime.ts`
- Modify: `App.tsx`
- Test: `tests/flovartBrowserRuntime.test.ts`

- [ ] Move queue polling and command completion out of `App.tsx` into one runtime service.
- [ ] Prevent overlapping polls, complete every claimed command exactly once, and send structured failures.
- [ ] Keep provider-backed commands paused while the document is hidden without losing leases.

### Task 4: Align The Tauri Bridge

**Files:**
- Modify: `src-tauri/src/bridge.rs`
- Modify: `src-tauri/src/http.rs`
- Test: Rust unit tests in `src-tauri/src/bridge.rs`

- [ ] Mirror command statuses, lease fields, error shape, and idempotency key in Rust.
- [ ] Reject completion of unknown or terminal entries and reclaim retryable expired leases.
- [ ] Reconcile startup state from the existing SQLite sync log rather than starting with an empty in-memory queue.

### Task 5: Contract Parity

**Files:**
- Create: `tests/flovartRuntimeContract.test.ts`
- Modify: `tools/flovart/runtime-client.js`
- Modify: `services/flovartRuntime.ts`

- [ ] Execute representative inspect, select, create, update-prompt, and invalid commands through direct and queued adapters.
- [ ] Assert normalized success and error results have identical command-visible fields.
- [ ] Keep `command.list` and `command.schema` authoritative and update aliases only when parity tests require it.

### Task 6: Runtime Acceptance

**Files:**
- Modify: `skills/flovart/commands/status.md`
- Modify: `skills/flovart/SKILL.md` only if command semantics changed.

- [ ] Run focused command, bridge, runtime, and compatibility tests.
- [ ] Run `npm run flovart:cli -- command.list --json` and inspect the machine-readable result.
- [ ] Run one inspect command and one queued no-op/selection command against an open development tab.
- [ ] Do not run the production build unless the user requests it.
