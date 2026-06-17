# Canvas And Workflow Dual-System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the non-graph Canvas and replace the removed legacy Workflow with an isolated multi-project editor, shared Flovart generation configuration, and one CLI/Agent/MCP command path.

**Architecture:** Canvas remains the existing SVG/Konva whiteboard and only owns Canvas boards. The new `components/workflow/` feature owns Workflow projects and graph UI, while narrow adapters call Flovart providers, assets, history, and command dispatch. A loopback Agent process borrows the reference project's token/origin/SSE/MCP connection pattern but forwards the existing Flovart command registry instead of defining another operation protocol.

**Tech Stack:** React 19, TypeScript, Vite, Zustand, localforage, Ant Design, Tailwind CSS, Lucide, Motion, nanoid, Node.js HTTP/SSE, MCP SDK, Codex app-server stdio.

**Reference:** `basketikun/infinite-canvas` commit `8cbe00e3486eec00bcaf21a7c5e55fefddf28500` under AGPL-3.0.

---

## File Structure

- `components/workflow/types.ts`: Workflow-only project, node, connection, config, and Agent snapshot types.
- `components/workflow/constants.ts`: Node dimensions and Workflow defaults.
- `components/workflow/store.ts`: Debounced localforage-backed project persistence.
- `components/workflow/ops.ts`: Pure graph mutation reducer used by UI, CLI, Agent, and MCP.
- `components/workflow/InfiniteWorkflow.tsx`: Viewport, selection, keyboard, drag, resize, and connection interaction coordinator.
- `components/workflow/WorkflowNode.tsx`: Image, text, video, and config node rendering.
- `components/workflow/WorkflowConnections.tsx`: Persisted and active Bezier paths with wide hit targets.
- `components/workflow/WorkflowToolbar.tsx`: Node creation, import, undo/redo, background, and Agent entry actions.
- `components/workflow/WorkflowMiniMap.tsx`: Viewport overview and navigation.
- `components/workflow/WorkflowProjectList.tsx`: Independent Workflow project CRUD.
- `components/workflow/WorkflowConfigPanel.tsx`: Provider-driven text/image/video generation controls.
- `components/workflow/WorkflowAgentPanel.tsx`: Online/local Agent modes, connect, chat, threads, logs, confirmations, and results.
- `components/workflow/WorkflowWorkspace.tsx`: Feature shell, project/editor routing, theme, and Canvas switch.
- `services/generationCapabilities.ts`: Shared provider/model parameter schema.
- `services/workflowGeneration.ts`: Upstream reference resolution and provider execution.
- `services/workflowDispatcher.ts`: Canonical browser dispatcher for Workflow commands.
- `services/workflowAgentBridge.ts`: Browser HTTP/SSE Agent client with redacted snapshots.
- `agent/index.js`: Loopback HTTP/SSE and MCP entrypoint under the repository AGPL license.
- `agent/session.js`: Token-authenticated browser session and pending command correlation.
- `agent/mcp.js`: Official MCP stdio adapter generated from Flovart command metadata.
- `agent/codex.js`: Codex app-server stdio thread/event adapter.
- `tools/flovart/core.js`: Adds Workflow command metadata and aliases only; remains the canonical CLI registry.
- `App.tsx`: Selective Canvas rollback and new workspace switch/render integration.

## Task 1: Selectively Restore Canvas

**Files:**
- Modify: `App.tsx`
- Modify: `components/AgentChatPanel.tsx`
- Modify: `hooks/useCanvasInteraction.ts`
- Modify: `hooks/useGeneration.ts`
- Modify: `types/index.ts`
- Modify: `utils/canvasHelpers.ts`
- Modify: `utils/historyState.ts`
- Modify: `tests/historyState.test.ts`
- Delete: `components/canvas/MediaNode.tsx`
- Delete: `components/canvas/MediaNodeConnections.tsx`
- Delete: `components/canvas/MediaNodeLayer.tsx`
- Delete: `components/canvas/mediaNodeGeometry.ts`
- Delete: `hooks/useMediaNodeConnections.ts`
- Delete: `hooks/useMediaVisibility.ts`
- Delete: `utils/canvasEdges.ts`
- Delete: `tests/boardGraphHistory.test.ts`
- Delete: `tests/canvasEdges.test.ts`
- Delete: `tests/mediaNodeConnections.test.tsx`
- Delete: `tests/mediaNodeGeometry.test.ts`
- Delete: `tests/mediaNodeIntegration.test.ts`
- Delete: `tests/mediaNodeLayer.test.tsx`
- Delete: `docs/superpowers/plans/2026-06-17-media-node-rendering.md`
- Delete: `docs/superpowers/plans/2026-06-17-media-storage-lifecycle.md`
- Delete: `docs/superpowers/specs/2026-06-17-media-node-rendering-design.md`

- [ ] **Step 1: Record the exact graph feature markers before editing**

Run only read-only searches for `CanvasEdge`, `MediaNode`, `useMediaNodeConnections`, `selectedEdgeId`, `setEdges`, `buildCanvasGenerationEdge`, `sourceElementIds`, and graph history snapshots. Do not modify Docker, logo, Agent UI, storage cleanup, or encoding fixes in the same files.

- [ ] **Step 2: Remove graph-only files with targeted patches**

Delete the listed untracked media-node, connection, geometry, graph test, and superseded design files. Keep `components/canvas/CanvasKonvaMediaLayer.tsx` because it predates this uncommitted graph experiment and belongs to the existing Canvas runtime.

- [ ] **Step 3: Restore Canvas board and history contracts**

Restore the public contracts to the `59256af` shape:

```ts
export interface Board {
  id: string;
  name: string;
  elements: Element[];
  history: Element[][];
  historyIndex: number;
}

export function appendHistorySnapshot(history: Element[][], historyIndex: number, elements: Element[]) {
  const next = [...history.slice(0, historyIndex + 1), elements];
  return { history: next, historyIndex: next.length - 1 };
}
```

Remove edge persistence, edge-aware undo/redo, output auto-connection effects, edge selection/deletion, and media-node DOM rendering from mixed files. Preserve unrelated user edits in those files.

- [ ] **Step 4: Restore existing SVG/Konva media behavior**

Ensure image/video elements again use the pre-graph branches already present in `App.tsx` and `CanvasKonvaMediaLayer`; remove graph-specific event interception from `useCanvasInteraction` without changing pan, zoom, resize, or selection behavior.

- [ ] **Step 5: Add a static regression test for the Canvas contract**

Create `tests/canvasWithoutWorkflowGraph.test.ts` that reads the exported Canvas types/helpers and asserts a new board has element history only and no `edges` field. The agent does not execute the test per repository instructions.

- [ ] **Step 6: Commit only the Canvas restoration**

Stage only the files listed in this task and commit with `fix: restore canvas before workflow graph changes`.

## Task 2: Add Workflow Types, Persistence, And Pure Operations

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `components/workflow/types.ts`
- Create: `components/workflow/constants.ts`
- Create: `components/workflow/storage.ts`
- Create: `components/workflow/store.ts`
- Create: `components/workflow/ops.ts`
- Test: `tests/workflowOps.test.ts`
- Test: `tests/workflowStore.test.ts`

- [ ] **Step 1: Add editor dependencies**

Add compatible versions of `antd`, `lucide-react`, `motion`, `nanoid`, and `localforage`. Keep React and Zustand at the versions already selected by Flovart.

- [ ] **Step 2: Define the isolated graph model**

```ts
export type WorkflowNodeType = 'image' | 'text' | 'video' | 'config';
export type WorkflowNodeStatus = 'idle' | 'loading' | 'success' | 'error';

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  title: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  metadata: {
    content?: string;
    prompt?: string;
    href?: string;
    mimeType?: string;
    status?: WorkflowNodeStatus;
    error?: string;
    config?: WorkflowGenerationConfig;
  };
}

export interface WorkflowConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

export interface WorkflowProject {
  id: string;
  title: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  viewport: { x: number; y: number; k: number };
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Implement localforage persistence**

Use a dedicated `flovart:workflow:projects` key, a 400 ms debounced writer, hydration state, and no compatibility conversion for old Workflow data.

- [ ] **Step 4: Implement pure operations**

`applyWorkflowOps(snapshot, ops)` supports add/update/delete node, delete/connect edges, selection, viewport, and run-generation intents. It rejects missing endpoints, self-links, and duplicates and removes incident connections transactionally when deleting nodes.

- [ ] **Step 5: Add focused operation and persistence tests**

Cover project CRUD, localforage hydration, duplicate/self-link rejection, transactional deletion, and viewport persistence. Write the tests but do not execute them.

- [ ] **Step 6: Commit the Workflow foundation**

Commit with `feat: add isolated workflow project model`.

## Task 3: Port The Workflow Editor

**Files:**
- Create: `components/workflow/InfiniteWorkflow.tsx`
- Create: `components/workflow/WorkflowNode.tsx`
- Create: `components/workflow/WorkflowConnections.tsx`
- Create: `components/workflow/WorkflowToolbar.tsx`
- Create: `components/workflow/WorkflowMiniMap.tsx`
- Create: `components/workflow/WorkflowContextMenu.tsx`
- Create: `components/workflow/WorkflowProjectList.tsx`
- Create: `components/workflow/WorkflowWorkspace.tsx`
- Create: `styles/workflow.css`
- Modify: `styles/index.css`
- Test: `tests/workflowEditor.test.tsx`

- [ ] **Step 1: Port viewport and background primitives**

Use one CSS transform for the world layer:

```tsx
<div
  className="workflow-world"
  style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})` }}
>
  <WorkflowConnections nodes={nodes} connections={connections} />
  {visibleNodes.map(node => <WorkflowNode key={node.id} node={node} />)}
</div>
```

Wheel zoom is cursor-centered, space/middle mouse pans, and fit view derives bounds from Workflow nodes only.

- [ ] **Step 2: Port selection and node interaction**

Implement click selection, additive selection, drag selection box, multi-node movement, resize handles, Delete/Backspace, copy/paste, and context actions. Keep node data immutable and commit one undo snapshot at gesture completion.

- [ ] **Step 3: Port connection interaction**

Render left target/right source handles. Use a transparent 16 px hit path plus a visible themed path. Dragging to empty space cancels and never creates a placeholder node.

- [ ] **Step 4: Port the four node renderers**

Image and video nodes use native media elements; text nodes use an editable text surface; config nodes show mode, model, prompt summary, and generation status. Audio-only UI and source imports are omitted.

- [ ] **Step 5: Port toolbar, minimap, and project shell**

Provide project create/rename/delete/switch, import image/video, create text/config, undo/redo, grid/background, fit view, zoom, and Agent panel actions. Apply Flovart theme variables instead of copying hard-coded source colors.

- [ ] **Step 6: Add component tests**

Cover project opening, viewport transform, selection, node drag, resize, connection creation/deletion, and the absence of audio nodes. Write the tests but do not execute them.

- [ ] **Step 7: Commit the editor**

Commit with `feat: port isolated workflow editor`.

## Task 4: Restore Workspace Switching

**Files:**
- Modify: `stores/useWorkspaceStore.ts`
- Modify: `types/index.ts`
- Modify: `App.tsx`
- Test: `tests/workspaceSwitch.test.tsx`

- [ ] **Step 1: Restore the persisted view state**

```ts
export type WorkspaceView = 'canvas' | 'workflow';

interface UISlice {
  activeView: WorkspaceView;
  setActiveView: (view: WorkspaceView) => void;
}
```

Persist `activeView` beside theme and language.

- [ ] **Step 2: Mount exactly one workspace**

Canvas remains the existing branch. Workflow lazy-loads `WorkflowWorkspace`. Both bottom bars call `setActiveView`, while legal, theme, and language actions stay shared.

- [ ] **Step 3: Add a switching regression test**

Assert that switching unmounts the inactive workspace, preserves the active Workflow project, and returns to the same Canvas board. Write the test but do not execute it.

- [ ] **Step 4: Commit the workspace integration**

Commit with `feat: restore canvas workflow switching`.

## Task 5: Share Provider Capabilities And Generate Result Nodes

**Files:**
- Create: `services/generationCapabilities.ts`
- Create: `services/workflowGeneration.ts`
- Create: `components/workflow/WorkflowConfigPanel.tsx`
- Modify: `components/CanvasSettings.tsx`
- Modify: `components/PromptBar.tsx`
- Modify: `services/aiGateway.ts`
- Modify: `components/workflow/store.ts`
- Test: `tests/generationCapabilities.test.ts`
- Test: `tests/workflowGeneration.test.ts`

- [ ] **Step 1: Extract the shared capability schema**

```ts
export interface GenerationCapability {
  mode: 'text' | 'image' | 'video';
  models: string[];
  aspectRatios: string[];
  resolutions: string[];
  durations: number[];
  supportsReferences: Array<'image' | 'video'>;
}

export function getGenerationCapability(
  keys: UserApiKey[],
  mode: GenerationCapability['mode'],
): GenerationCapability;
```

Build this from current provider/model metadata; do not duplicate hard-coded model lists from the reference project.

- [ ] **Step 2: Make existing selectors consume the shared schema**

Keep Canvas UI unchanged. Replace only duplicated option derivation in current PromptBar/settings code with capability selectors.

- [ ] **Step 3: Resolve Workflow inputs**

Walk direct incoming connections, collect text content as prompt context, image/video media as references, merge explicit node prompt content, and filter slots through the selected model capability dictionary.

- [ ] **Step 4: Execute through the current provider path**

Use `executeUnifiedIgnition` for image/video and the existing text provider route for text. Update the config node to `loading`, then `success` or a retryable `error` with the provider message.

- [ ] **Step 5: Create a result node after success**

Place the result to the right of the config node, write image/video/text metadata, add `config -> result`, and append the existing generation history record. Never replace the source/config node.

- [ ] **Step 6: Add capability and generation tests**

Cover unsupported control disabling, upstream prompt/reference merging, provider failure retention, new result placement, automatic connection, and history writes. Write the tests but do not execute them.

- [ ] **Step 7: Commit provider integration**

Commit with `feat: connect workflow nodes to flovart providers`.

## Task 6: Add One Browser Workflow Dispatcher

**Files:**
- Create: `services/workflowDispatcher.ts`
- Create: `components/workflow/agentOps.ts`
- Modify: `components/workflow/WorkflowWorkspace.tsx`
- Modify: `services/flovartRuntime.ts`
- Test: `tests/workflowDispatcher.test.ts`

- [ ] **Step 1: Define command results and mutation previews**

```ts
export interface WorkflowCommandEnvelope {
  id: string;
  command: string;
  args: Record<string, unknown>;
  source: 'ui' | 'cli' | 'agent' | 'mcp';
  idempotencyKey?: string;
}

export interface WorkflowCommandResult {
  ok: boolean;
  commandId: string;
  result?: unknown;
  error?: { code: string; message: string };
}
```

- [ ] **Step 2: Route every graph mutation through pure ops**

Read commands return redacted snapshots. Mutating commands first return a summary for confirmation when `source` is Agent/MCP, then apply `applyWorkflowOps` once after approval. Cache idempotency keys for the current browser session.

- [ ] **Step 3: Expose the dispatcher on the browser runtime**

Extend `window.__flovartAPI` with `workflow.dispatch(envelope)` without exposing React components or stores as public APIs.

- [ ] **Step 4: Add dispatcher tests**

Cover read/mutation commands, confirmation, denial, validation errors, idempotent retries, and redaction. Write the tests but do not execute them.

- [ ] **Step 5: Commit the dispatcher**

Commit with `feat: add workflow command dispatcher`.

## Task 7: Extend CLI Metadata With Workflow Commands

**Files:**
- Modify: `tools/flovart/core.js`
- Modify: `tools/flovart/runtime-client.js`
- Modify: `tools/flovart/shadow-runtime.js`
- Modify: `skills/flovart/commands/workflow.md`
- Modify: `.agents/skills/flovart/commands/workflow.md`
- Test: `tests/flovartLibtvCompat.test.ts`
- Test: `tests/workflowCli.test.js`

- [ ] **Step 1: Register Workflow commands**

Add `workflow.project.list/create/use/delete`, `workflow.inspect`, `workflow.node.create/update/delete/move/resize`, `workflow.connect/disconnect`, `workflow.select`, `workflow.viewport.set`, and `workflow.node.run` with machine-readable argument schemas.

- [ ] **Step 2: Add stable MCP-safe aliases**

Map dotted commands to names such as `flovart_workflow_node_create` without creating separate behavior or schemas.

- [ ] **Step 3: Route commands through the browser bridge**

Browser-connected commands call `workflow.dispatch`. Shadow mode stores Workflow projects separately and reports that provider generation requires the browser.

- [ ] **Step 4: Update CLI documentation and tests**

Document exact JSON commands and cover registry/schema/alias parity. Write the tests but do not execute them.

- [ ] **Step 5: Commit CLI metadata**

Commit with `feat: expose workflow commands through flovart cli`.

## Task 8: Add The Loopback Agent And MCP Bridge

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `agent/index.js`
- Create: `agent/config.js`
- Create: `agent/session.js`
- Create: `agent/mcp.js`
- Create: `agent/codex.js`
- Create: `services/workflowAgentBridge.ts`
- Test: `tests/workflowAgentSession.test.js`
- Test: `tests/workflowAgentBridge.test.ts`

- [ ] **Step 1: Add the official MCP dependency and Agent script**

Add `@modelcontextprotocol/sdk` and a root script `flovart:agent`. Keep Agent files outside the MIT `tools/flovart` package while importing its command metadata read-only.

- [ ] **Step 2: Implement token/origin protection**

Listen on `127.0.0.1`, generate a token, allow `/health` and `/config` without credentials, bind the first authenticated browser Origin, and reject other origins or invalid tokens.

- [ ] **Step 3: Implement HTTP/SSE correlation**

Maintain browser clients, latest redacted snapshot, pending request IDs, 30-second timeouts, `hello`/`ping` events, `tool_call` delivery, and `/workflow/result` resolution.

- [ ] **Step 4: Generate MCP tools from Flovart metadata**

Register MCP tools over stdio from `COMMAND_REGISTRY`/aliases. Each call posts one command envelope to the loopback session and returns normalized JSON text.

- [ ] **Step 5: Add Codex app-server thread transport**

Spawn `codex app-server --stdio`, correlate JSON-RPC requests, preserve thread IDs, and forward `thread.*`, `turn.*`, `item.*`, and streaming deltas to SSE clients. Stop the child process when the Agent exits.

- [ ] **Step 6: Implement the browser bridge**

Connect with URL/token, push the current Workflow snapshot, receive tool calls, request confirmation for mutations, dispatch approved commands, and post structured results.

- [ ] **Step 7: Add bridge tests**

Cover token failure, first-origin binding, SSE reconnect, tool timeout, result correlation, MCP metadata parity, snapshot redaction, and child-process shutdown. Write the tests but do not execute them.

- [ ] **Step 8: Commit Agent/MCP transport**

Commit with `feat: bridge flovart cli through local agent and mcp`.

## Task 9: Port And Integrate The Agent UI

**Files:**
- Create: `components/workflow/WorkflowAgentPanel.tsx`
- Create: `components/workflow/WorkflowAgentMessages.tsx`
- Create: `components/workflow/WorkflowAgentConnect.tsx`
- Create: `components/workflow/WorkflowAgentHistory.tsx`
- Create: `components/workflow/WorkflowAgentLogs.tsx`
- Modify: `components/workflow/WorkflowWorkspace.tsx`
- Modify: `services/agentOrchestrator.ts`
- Test: `tests/workflowAgentPanel.test.tsx`

- [ ] **Step 1: Port the Agent panel shell**

Provide Online/Local mode selection plus Connect, Chat, History, and Logs tabs. Use Flovart theme variables and Chinese product copy.

- [ ] **Step 2: Reuse online Agent orchestration**

Online mode calls the existing Flovart text provider and tool orchestration with the redacted Workflow snapshot and selected/upstream context.

- [ ] **Step 3: Bind local structured events**

Local mode displays connection state, thread list, resume/archive, streaming messages, tool previews, confirmations, command results, errors, and bounded diagnostic logs from `workflowAgentBridge`.

- [ ] **Step 4: Handle attachments safely**

Send attachment metadata to the Agent panel and only transfer selected local image bytes through the authenticated loopback request; never include media payloads in routine snapshots or logs.

- [ ] **Step 5: Add UI tests**

Cover online/local switching, connect errors, thread resume, streamed delta coalescing, mutation confirmation/denial, result rendering, and secret/media redaction. Write the tests but do not execute them.

- [ ] **Step 6: Commit Agent UI integration**

Commit with `feat: integrate workflow agent experience`.

## Task 10: Remove Residue, Attribute Upstream, And Update Project Docs

**Files:**
- Delete: remaining legacy Workflow-only files discovered by `git ls-tree` and import search
- Create: `docs/THIRD_PARTY_NOTICES.md`
- Create or modify: `docs/content/docs/progress/todo.mdx`
- Create or modify: `docs/content/docs/progress/pending-test.mdx`
- Modify: `CHANGELOG.md`
- Modify: `AGENTS.md` only if a repeated implementation issue produced a new durable rule

- [ ] **Step 1: Remove legacy Workflow residue**

Search imports and tracked filenames for old Workflow/nodeflow engines, adapters, tests, screenshots, and dead styles. Keep shared runtime/provider code only when the new implementation imports it.

- [ ] **Step 2: Add upstream attribution**

Record the source repository, reference commit, original author/project, AGPL-3.0 license, copied/adapted file families, and local modifications.

- [ ] **Step 3: Update progress documentation**

Move the dual-system item from the progress backlog into pending test, listing Canvas rollback, Workflow editor, config/provider sharing, Agent UI, CLI/MCP bridge, and user verification steps. Keep the formal feature document unchanged until the user confirms testing.

- [ ] **Step 4: Update the changelog**

Add one concise Unreleased summary for the dual-system architecture without duplicating implementation details.

- [ ] **Step 5: Perform non-executing acceptance inspection**

Per project instructions, do not run syntax checks, tests, builds, or compilation. Inspect diffs and static references only, then report the exact commands the user can run: focused Vitest files followed by `npm run build` if they choose.

- [ ] **Step 6: Commit documentation and cleanup**

Commit with `docs: record dual-system workflow delivery`.

## Plan Self-Review

- Every design requirement maps to Tasks 1-10.
- Canvas rollback is isolated from unrelated dirty-worktree changes.
- Workflow data never reuses Canvas `Board` or `Element` graph fields.
- UI, CLI, online Agent, local Agent, and MCP converge on `workflowDispatcher`.
- AGPL-derived Agent code stays outside the separately published MIT CLI package.
- No legacy graph-data migration or whole-graph runner is introduced.
- Test files are written but commands are not executed, following project instructions.
