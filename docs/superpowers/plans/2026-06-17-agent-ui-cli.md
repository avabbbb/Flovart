# Agent UI And CLI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Flovart an embedded Agent and Tauri Codex experience that use the deterministic CLI command registry, real results, confirmation, thread history, and structured logs.

**Architecture:** Agent planning emits canonical Flovart tool calls. A shared controller owns compact canvas snapshots, confirmation, execution, and events; online model and Tauri Codex adapters only translate model/thread events. The existing right panel keeps Flovart styling and renders controller state.

**Tech Stack:** React, Zustand or existing local state patterns, Flovart CLI core, Tauri child-process stdio, Vitest, Testing Library.

---

### Task 1: Define Agent Events And Compact Context

**Files:**
- Create: `services/agentRuntime/types.ts`
- Create: `services/agentRuntime/canvasSnapshot.ts`
- Create: `tests/agentCanvasSnapshot.test.ts`

- [ ] Define thread, turn, message, tool-call, confirmation, result, usage, and error event unions.
- [ ] Build a snapshot with element IDs, image/video metadata, edges, selected IDs, viewport, prompt metadata, and generation status.
- [ ] Redact API keys, data URLs, Blob contents, local paths, and full media payloads; test each redaction explicitly.

### Task 2: Build The Shared Agent Controller

**Files:**
- Create: `services/agentRuntime/controller.ts`
- Create: `services/agentRuntime/toolPolicy.ts`
- Test: `tests/agentRuntimeController.test.ts`

- [ ] Allow read commands immediately and classify every mutating command for preview and confirmation.
- [ ] Execute confirmed commands through `executeFlovartCommand` and emit result/error only from the real dispatcher response.
- [ ] Support cancel, disconnect, bounded event logs, and one board undo after a successful mutation batch.

### Task 3: Replace Optimistic AgentChatPanel Execution

**Files:**
- Modify: `components/AgentChatPanel.tsx`
- Modify: `components/RightPanel.tsx`
- Test: `tests/agentChatPanel.test.ts`
- Create: `tests/agentToolConfirmation.test.tsx`

- [ ] Replace the hard-coded image/video three-command loop with controller tool calls generated from canonical command schemas.
- [ ] Keep selected/upstream context but send compact metadata instead of concatenating unbounded node content.
- [ ] Show planning, confirmation, execution, generation wait, success, failure, and disconnected states.
- [ ] Never show success before the command result reports success.

### Task 4: Add Connect, Chat, History, And Logs Views

**Files:**
- Modify: `components/AgentChatPanel.tsx`
- Remove or fold: `components/AgentBridgePanel.tsx`
- Create: `stores/useAgentRuntimeStore.ts`
- Test: `tests/agentPanelViews.test.tsx`

- [ ] Store bounded messages, threads, active thread, connection state, pending confirmation, and logs outside the large panel component.
- [ ] Keep Flovart theme tokens and render four clear views without copying the reference project's styling.
- [ ] Support resume, rename, archive, clear logs, reconnect, and confirmation controls.

### Task 5: Add Online Model Adapter

**Files:**
- Create: `services/agentRuntime/onlineAdapter.ts`
- Modify: `services/agentOrchestrator.ts`
- Test: `tests/agentOnlineAdapter.test.ts`

- [ ] Translate current provider responses into the shared event union.
- [ ] Validate tool names and JSON arguments against `command.schema` before controller execution.
- [ ] Preserve current provider routing and abort behavior while removing `[FINAL_PROMPT]` as the command-completion signal.

### Task 6: Add Tauri Codex Adapter Without A New Protocol Server

**Files:**
- Create: `src-tauri/src/agent.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `services/agentRuntime/tauriCodexAdapter.ts`
- Test: Rust unit tests in `src-tauri/src/agent.rs`
- Test: `tests/tauriCodexAdapter.test.ts`

- [ ] Start and supervise Codex app-server as a Tauri child process using stdio only.
- [ ] Convert thread/turn/item events into the shared event union and keep canvas mutation execution in the Flovart dispatcher.
- [ ] Handle missing Codex, process exit, cancellation, and reconnect without adding MCP or a loopback Agent server.

### Task 7: Preserve Direct CLI Operation

**Files:**
- Modify: `components/AgentChatPanel.tsx`
- Modify: `skills/flovart/commands/status.md`
- Test: `tests/agentRuntimeConfig.test.ts`

- [ ] Show deterministic CLI setup and readiness from `command.list`, runtime status, and provider status.
- [ ] Keep `npm run flovart:cli -- <command> --json` as the documented external-agent path.
- [ ] Confirm the Agent UI does not require CLI installation for embedded online use.

### Task 8: Agent Acceptance

**Files:**
- Modify tests only for newly discovered regressions.

- [ ] Run focused snapshot, controller, panel, online adapter, Tauri adapter, runtime contract, and existing Agent tests.
- [ ] Verify one read-only request, one confirmed image creation, one rejected mutation, one failed provider call, thread resume, and direct CLI canvas inspection.
- [ ] Confirm logs and snapshots contain no keys, Blob/data URL payloads, or local paths.
- [ ] Do not run the production build unless the user requests it.
