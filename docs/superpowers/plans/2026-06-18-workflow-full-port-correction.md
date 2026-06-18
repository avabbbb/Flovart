# Workflow Full-Port Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simplified Workflow editor with a coherent port of the reference canvas interactions while preserving Flovart persistence, provider, history, Agent, CLI, and MCP ownership.

**Architecture:** Reference interaction modules become the Workflow UI baseline. A canonical Workflow store and pure operation layer own graph state, while narrow adapters connect durable media, Flovart PromptBar/ElementToolbar behavior, provider execution, assets, Agent transport, and command dispatch. Canvas remains independently mounted and persisted.

**Tech Stack:** React 19, TypeScript, Vite, Zustand, localforage, Ant Design, Tailwind CSS, Lucide, nanoid, Vitest, Testing Library, Node.js HTTP/SSE, MCP SDK.

**Reference:** `basketikun/infinite-canvas` commit `8cbe00e3486eec00bcaf21a7c5e55fefddf28500`, AGPL-3.0.

---

## File Structure

- `components/workflow/types.ts`: canonical reference-derived Workflow node, connection, media, generation, and project types.
- `components/workflow/constants.ts`: node specs and creation defaults for text/image/video/audio/config nodes.
- `components/workflow/ops.ts`: all validated UI/Agent/CLI/MCP graph mutations.
- `components/workflow/store.ts`: project ownership and debounced localforage persistence.
- `components/workflow/media.ts`: file validation, metadata inspection, durable media ingestion, and node sizing.
- `components/workflow/InfiniteWorkflow.tsx`: reference-derived surface event coordinator and history controller.
- `components/workflow/WorkflowNode.tsx`: media/text/config node renderer only.
- `components/workflow/WorkflowConnections.tsx`: visible/active paths and connection hit areas.
- `components/workflow/WorkflowCreateMenu.tsx`: double-click and connection-drop node type menu.
- `components/workflow/WorkflowNodeToolbar.tsx`: DOM Workflow adapter for Flovart ElementToolbar actions.
- `components/workflow/WorkflowNodePromptBar.tsx`: Workflow adapter around the existing `PromptBar`.
- `components/workflow/WorkflowConfigPanel.tsx`: Flovart capability-backed node config surface.
- `components/workflow/WorkflowToolbar.tsx`: import/create/history/background/Agent actions.
- `components/workflow/WorkflowMiniMap.tsx`: viewport overview and navigation.
- `components/workflow/WorkflowWorkspace.tsx`: project shell and Flovart runtime context.
- `services/workflowGeneration.ts`: upstream input resolution, provider request lifecycle, cancellation, results, and history.
- `services/workflowDispatcher.ts`: canonical command validation and dispatch.
- `services/workflowAgentBridge.ts`: browser bridge for Agent/CLI/MCP requests.
- `styles/workflow.css`: Workflow-only reference-derived layout using Flovart theme variables.
- `tests/workflow*.test.*`: focused state, interaction, provider, Agent, CLI, and MCP coverage.

## Task 1: Replace The Reduced Workflow Domain Model

**Files:**
- Modify: `components/workflow/types.ts`
- Modify: `components/workflow/constants.ts`
- Modify: `components/workflow/ops.ts`
- Modify: `components/workflow/store.ts`
- Modify: `tests/workflowOps.test.ts`
- Modify: `tests/workflowStore.test.ts`

- [ ] **Step 1: Write model tests before implementation**

Add assertions that the canonical node union includes `audio`, connection validation returns a reason, create-and-connect is atomic, and project persistence retains media/config/session metadata.

```ts
const source = createWorkflowNode('source', 'image', { x: 0, y: 0 });
const created = createWorkflowNode('created', 'video', { x: 500, y: 0 });
const result = applyWorkflowOps(snapshot([source]), [
  { type: 'create_connected_node', fromNodeId: source.id, node: created },
]);
expect(result.snapshot.nodes).toContainEqual(created);
expect(result.snapshot.connections[0]).toMatchObject({ fromNodeId: source.id, toNodeId: created.id });
```

- [ ] **Step 2: Replace the node/config types**

Define `WorkflowNodeType = 'image' | 'text' | 'video' | 'audio' | 'config'`, reference-compatible node metadata, rich prompt document, durable media key, generation request ID, status/error, provider config, and project background/session fields. Keep API keys out of all Workflow types.

```ts
export type WorkflowOp =
  | { type: 'add_node'; node: WorkflowNode }
  | { type: 'create_connected_node'; fromNodeId: string; node: WorkflowNode }
  | { type: 'update_node'; id: string; patch?: Partial<Omit<WorkflowNode, 'id'>>; metadata?: WorkflowNodeMetadata }
  | { type: 'delete_nodes'; ids: string[] }
  | { type: 'connect_nodes'; id?: string; fromNodeId: string; toNodeId: string }
  | { type: 'delete_connections'; ids?: string[]; all?: boolean }
  | { type: 'select_nodes'; ids: string[] }
  | { type: 'set_viewport'; viewport: WorkflowViewport }
  | { type: 'run_generation'; nodeId: string };
```

- [ ] **Step 3: Make validation explicit and shared**

Add `validateWorkflowConnection(snapshot, fromNodeId, toNodeId)` returning `{ ok: true }` or `{ ok: false; reason }`. Reject missing endpoints, self-links, duplicates, cycles, and config-to-config links. Make both `connect_nodes` and `create_connected_node` use it.

- [ ] **Step 4: Keep persistence canonical**

Persist only `projects` and `activeProjectId` through `localforage`. Remove compatibility conversion. Ensure `selectedNodeIds` is normalized during hydration so missing node IDs are removed.

- [ ] **Step 5: Perform static inspection**

Inspect imports for the removed four-type union and the old rule that empty connection drops cancel. Per project instructions, do not run tests or build.

- [ ] **Step 6: Commit the domain replacement**

```powershell
git add components/workflow/types.ts components/workflow/constants.ts components/workflow/ops.ts components/workflow/store.ts tests/workflowOps.test.ts tests/workflowStore.test.ts
git commit -m "refactor: replace reduced workflow model"
```

## Task 2: Port The Surface Controller And Creation Interactions

**Files:**
- Replace: `components/workflow/InfiniteWorkflow.tsx`
- Replace: `components/workflow/WorkflowConnections.tsx`
- Create: `components/workflow/WorkflowCreateMenu.tsx`
- Modify: `components/workflow/WorkflowContextMenu.tsx`
- Modify: `components/workflow/WorkflowMiniMap.tsx`
- Replace: `tests/workflowEditor.test.tsx`

- [ ] **Step 1: Write interaction tests before implementation**

Cover cursor zoom, background pan, additive/box selection, one history entry per drag, empty-space double-click menu, source-handle empty drop menu, valid existing-target connection, menu cancellation, keyboard delete, and undo/redo.

```tsx
fireEvent.doubleClick(screen.getByTestId('workflow-editor'), { clientX: 420, clientY: 260 });
expect(screen.getByRole('menu', { name: '新建节点' })).toBeVisible();
fireEvent.click(screen.getByRole('menuitem', { name: '图片生成' }));
expect(onProjectChange).toHaveBeenCalledWith(expect.objectContaining({ nodes: expect.arrayContaining([expect.objectContaining({ type: 'image' })]) }));
```

- [ ] **Step 2: Port the reference viewport controller**

Use one transformed world layer. Track viewport/node/connection refs for global pointer handlers, use `requestAnimationFrame` for drag updates, and commit a history snapshot only on completed gestures.

- [ ] **Step 3: Add double-click creation**

On a true background double-click, convert client coordinates with `screenToWorkflow`, store `{ position, connection: null }`, and render `WorkflowCreateMenu`. Ignore double-clicks originating from nodes, overlays, dialogs, media controls, or toolbars.

- [ ] **Step 4: Port empty-drop create-and-connect**

Use reference hit testing around target handles and node bounds. If a connection ends away from a node, open the same menu with the pending source handle. Choosing a type dispatches one `create_connected_node` operation.

- [ ] **Step 5: Port selection and connection paths**

Keep wide transparent hit paths, selected path deletion, active drag preview, box selection, multi-node movement, resize, keyboard shortcuts, clipboard node cloning, and context actions. Use theme variables for path/selection colors.

- [ ] **Step 6: Perform static inspection and commit**

```powershell
git add components/workflow/InfiniteWorkflow.tsx components/workflow/WorkflowConnections.tsx components/workflow/WorkflowCreateMenu.tsx components/workflow/WorkflowContextMenu.tsx components/workflow/WorkflowMiniMap.tsx tests/workflowEditor.test.tsx
git commit -m "feat: port workflow surface interactions"
```

## Task 3: Add Durable Drag-And-Drop Media Nodes

**Files:**
- Create: `components/workflow/media.ts`
- Replace: `components/workflow/WorkflowNode.tsx`
- Modify: `components/workflow/InfiniteWorkflow.tsx`
- Modify: `components/workflow/WorkflowToolbar.tsx`
- Modify: `components/workflow/storage.ts`
- Create: `tests/workflowMedia.test.ts`

- [ ] **Step 1: Write media tests before implementation**

Cover image/video/audio MIME acceptance, original aspect-ratio sizing, drop world position, toolbar/drop ingestion parity, durable key persistence, object URL cleanup, replacement, and unsupported-file messages.

- [ ] **Step 2: Implement one ingestion function**

```ts
export async function ingestWorkflowMedia(file: File): Promise<WorkflowMediaRecord> {
  const type = workflowMediaType(file);
  if (!type) throw new Error('仅支持图片、视频和音频文件');
  const id = nanoid();
  const metadata = await inspectWorkflowMedia(file, type);
  await workflowMediaStorage.set(id, file);
  return { id, type, mimeType: file.type, name: file.name, ...metadata };
}
```

Store blobs through a dedicated localforage store. Persist the durable key and metadata on nodes; create/revoke object URLs only in the rendering lifetime.

- [ ] **Step 3: Bind surface drop and paste**

Add `onDragOver={event => event.preventDefault()}` and an async `onDrop` that selects the first supported file, converts drop coordinates, ingests it, creates the typed node, and reports errors. Add clipboard image/text creation through the same operation layer.

- [ ] **Step 4: Render reference media nodes**

Use `<img draggable={false}>`, `<video controls preload="metadata" playsInline>`, and `<audio controls preload="metadata">`. Preserve original image/video aspect ratio unless free resize is explicitly enabled. Render replace/remove actions for missing media.

- [ ] **Step 5: Make toolbar import call the same ingestion path**

Remove FileReader-only duplication from `WorkflowToolbar`. Pass selected files to `ingestWorkflowMedia` and place them at the viewport center.

- [ ] **Step 6: Perform static inspection and commit**

```powershell
git add components/workflow/media.ts components/workflow/WorkflowNode.tsx components/workflow/InfiniteWorkflow.tsx components/workflow/WorkflowToolbar.tsx components/workflow/storage.ts tests/workflowMedia.test.ts
git commit -m "feat: add workflow media ingestion"
```

## Task 4: Port Node Toolbar And Prompt Surfaces

**Files:**
- Create: `components/workflow/WorkflowNodeToolbar.tsx`
- Create: `components/workflow/WorkflowNodePromptBar.tsx`
- Replace: `components/workflow/WorkflowConfigPanel.tsx`
- Modify: `components/workflow/InfiniteWorkflow.tsx`
- Modify: `components/workflow/WorkflowWorkspace.tsx`
- Modify: `components/PromptBar.tsx`
- Modify: `components/ElementToolbar.tsx`
- Create: `tests/workflowNodeOverlays.test.tsx`

- [ ] **Step 1: Write overlay tests before implementation**

Cover selected-node visibility, stable screen-space scale, pointer isolation, prompt updates, mentions, mode/model changes, run/stop/retry, copy/download/delete, media replacement, and overlay dismissal.

- [ ] **Step 2: Extract reusable DOM control bodies**

Keep the existing exported Canvas components working. Extract only the inner PromptBar and ElementToolbar control bodies needed by Workflow so Canvas SVG positioning and Workflow DOM positioning share actions and visual behavior without rendering a `<foreignObject>` outside SVG.

```ts
export interface ElementToolbarActions {
  copy: () => void;
  download?: () => void;
  replaceMedia?: () => void;
  delete: () => void;
  run?: () => void;
  retry?: () => void;
}
```

- [ ] **Step 3: Position Workflow overlays in screen space**

Calculate `left = viewport.x + (node.position.x + node.width / 2) * viewport.k` and corresponding top/bottom coordinates. Render overlays outside the scaled world with `translateX(-50%)`. Stop pointer/mouse/wheel propagation inside both overlays.

- [ ] **Step 4: Bind PromptBar to node metadata**

Map node prompt, rich document, mode, provider model, video settings, batch count, status, error, progress, retry, and mentions to the existing PromptBar interface. Update the canonical node through `update_node`; run through `onRunNode(node.id)`.

- [ ] **Step 5: Port node-specific toolbar actions**

Provide reference hover toolbar behavior and Flovart ElementToolbar actions appropriate to each type. Keep image/video download, copy, replace, save asset, delete, prompt edit, retry, and current image tools where their existing handlers can operate on Workflow media.

- [ ] **Step 6: Perform static inspection and commit**

```powershell
git add components/workflow/WorkflowNodeToolbar.tsx components/workflow/WorkflowNodePromptBar.tsx components/workflow/WorkflowConfigPanel.tsx components/workflow/InfiniteWorkflow.tsx components/workflow/WorkflowWorkspace.tsx components/PromptBar.tsx components/ElementToolbar.tsx tests/workflowNodeOverlays.test.tsx
git commit -m "feat: port workflow node prompt and toolbar"
```

## Task 5: Reconcile Provider Execution And Result Lifecycle

**Files:**
- Modify: `services/workflowGeneration.ts`
- Modify: `services/generationCapabilities.ts`
- Modify: `components/workflow/WorkflowConfigPanel.tsx`
- Modify: `App.tsx`
- Modify: `tests/workflowGeneration.test.ts`
- Modify: `tests/generationCapabilities.test.ts`

- [ ] **Step 1: Write lifecycle tests before implementation**

Cover direct node prompt generation, config-node generation, upstream text/reference collection, unsupported reference filtering, request cancellation, stale response rejection, loading/success/error/retry, result node creation, connection, and history writing.

- [ ] **Step 2: Resolve canonical generation input**

Collect direct incoming nodes in connection order. Merge text content and explicit prompt. Convert supported image/video/audio media to Flovart reference slots. Resolve the selected model through current `UserApiKey` and `ModelPreference` state.

- [ ] **Step 3: Add request identity and cancellation**

Maintain an `AbortController` and request ID per initiating node. Store the request ID in node metadata when loading. Ignore completion if the current node request ID changed.

- [ ] **Step 4: Keep current provider routes**

Use `generateTextWithProvider` for text and `executeUnifiedIgnition` for image/video. Do not copy reference API clients or API-key storage. Show unsupported audio generation as a capability-disabled mode while retaining audio reference nodes.

- [ ] **Step 5: Commit result and history atomically**

After provider success, create a typed result to the right, add one connection, update source status, persist the project, then write existing generation history. History failure logs a warning but does not remove a successful result.

- [ ] **Step 6: Perform static inspection and commit**

```powershell
git add services/workflowGeneration.ts services/generationCapabilities.ts components/workflow/WorkflowConfigPanel.tsx App.tsx tests/workflowGeneration.test.ts tests/generationCapabilities.test.ts
git commit -m "feat: bind full workflow to flovart providers"
```

## Task 6: Port Agent Experience And Reconcile Command Surfaces

**Files:**
- Replace: `components/workflow/WorkflowAgentPanel.tsx`
- Modify: `components/workflow/WorkflowAgentMessages.tsx`
- Modify: `components/workflow/agentOps.ts`
- Modify: `services/workflowDispatcher.ts`
- Modify: `services/workflowAgentBridge.ts`
- Modify: `agent/index.js`
- Modify: `agent/session.js`
- Modify: `agent/mcp.js`
- Modify: `agent/codex.js`
- Modify: `tools/flovart/core.js`
- Modify: `tools/flovart/runtime-client.js`
- Modify: `tools/flovart/shadow-runtime.js`
- Modify: `tests/workflowAgentPanel.test.tsx`
- Modify: `tests/workflowDispatcher.test.ts`
- Modify: `tests/workflowAgentBridge.test.ts`
- Modify: `tests/workflowCli.test.js`
- Modify: `tests/workflowAgentSession.test.js`

- [ ] **Step 1: Write command parity tests before implementation**

Assert that UI-equivalent create/connect/update/delete/select/viewport/run commands produce the same snapshots through dispatcher, CLI alias, and MCP metadata. Cover confirmation, denial, idempotency, timeout, redaction, and attachment limits.

- [ ] **Step 2: Port the full reference Agent panel states**

Implement Online/Local modes and Connect, Chat, History, Logs. Preserve threads, resume/archive, streaming deltas, attachments, tool previews, confirmation, structured results, disconnect state, and bounded logs using Flovart theme/copy.

- [ ] **Step 3: Make dispatcher consume canonical operations**

Update schemas for audio nodes, rich prompt/config metadata, `create_connected_node`, media-safe inspection, and generation cancellation. Keep `COMMAND_REGISTRY` the source for CLI/MCP schemas and aliases.

- [ ] **Step 4: Keep bridge protections**

Retain loopback-only binding, token authentication, first-origin binding, SSE correlation, timeouts, idempotency, mutation confirmation, and snapshot redaction. Never serialize API keys, blobs, data URLs, or local file paths.

- [ ] **Step 5: Perform static inspection and commit**

```powershell
git add components/workflow/WorkflowAgentPanel.tsx components/workflow/WorkflowAgentMessages.tsx components/workflow/agentOps.ts services/workflowDispatcher.ts services/workflowAgentBridge.ts agent tools/flovart/core.js tools/flovart/runtime-client.js tools/flovart/shadow-runtime.js tests/workflowAgentPanel.test.tsx tests/workflowDispatcher.test.ts tests/workflowAgentBridge.test.ts tests/workflowCli.test.js tests/workflowAgentSession.test.js
git commit -m "feat: reconcile workflow agent cli and mcp"
```

## Task 7: Remove Simplified Residue And Update Product Documentation

**Files:**
- Replace: `styles/workflow.css`
- Modify: `docs/THIRD_PARTY_NOTICES.md`
- Modify: `docs/content/docs/progress/todo.mdx`
- Modify: `docs/content/docs/progress/pending-test.mdx`
- Modify: `CHANGELOG.md`
- Delete: simplified Workflow-only files with no canonical imports after replacement

- [ ] **Step 1: Remove contradictory tests and dead imports**

Search for four-type node unions, `connectionDrag` empty-drop cancellation, FileReader-only Workflow upload, placeholder config panels, and simplified toolbar classes. Delete only dead Workflow code; preserve unrelated dirty-worktree changes.

- [ ] **Step 2: Finish reference-derived styling**

Use Flovart theme variables for canvas, node, overlay, connection, selection, status, and panel colors. Keep toolbar/status UI flat and low-weight per Canvas UI rules. Do not add page-private styles to global CSS.

- [ ] **Step 3: Record upstream attribution**

Add source repository, reference commit, license, adapted module families, and local provider/storage/Agent differences to `docs/THIRD_PARTY_NOTICES.md`.

- [ ] **Step 4: Update progress documentation**

Move implemented items from todo to pending-test. List concrete user checks for double-click creation, direct drop, overlays, create-from-node, provider results/history, Agent, CLI, and MCP. Keep formal feature docs unchanged until the user confirms runtime testing.

- [ ] **Step 5: Perform final static acceptance inspection**

Use read-only searches and `git diff --check`. Do not run tests, syntax checks, build, or compilation. Report the following optional user commands without executing them:

```powershell
npm test -- tests/workflowOps.test.ts tests/workflowMedia.test.ts tests/workflowEditor.test.tsx tests/workflowNodeOverlays.test.tsx tests/workflowGeneration.test.ts
npm test -- tests/workflowDispatcher.test.ts tests/workflowAgentBridge.test.ts tests/workflowAgentPanel.test.tsx
npm run build
```

- [ ] **Step 6: Commit cleanup and documentation**

```powershell
git add styles/workflow.css docs/THIRD_PARTY_NOTICES.md docs/content/docs/progress/todo.mdx docs/content/docs/progress/pending-test.mdx CHANGELOG.md components/workflow tests
git commit -m "docs: record full workflow port for testing"
```

## Plan Self-Review

- Tasks 1-4 cover every editor interaction and overlay acceptance criterion.
- Task 5 keeps Flovart provider/data ownership and covers status, cancellation, results, and history.
- Task 6 makes Agent, CLI, and MCP operate on the same canonical model.
- Task 7 removes reduced implementation residue, preserves attribution, and updates required docs.
- Type names and operation names remain consistent across domain, UI, provider, and command tasks.
- No legacy Workflow migration, duplicate provider client, API-key serialization, or Canvas graph merge is introduced.
- Tests are written before implementation but are not executed by Codex, following repository instructions.
