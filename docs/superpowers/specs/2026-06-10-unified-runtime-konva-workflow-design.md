# Unified Runtime and Konva Workflow Design

## Goal

Refactor Flovart so Canvas elements and Workflow nodes are the same underlying runtime entities. Canvas and Workflow become two UI projections of one project runtime, with a shared prompt system, shared connection graph, and a phased Konva rendering layer for high-performance local media editing.

## Current Problems

Flovart currently has separate state surfaces:

- Canvas owns `elements`, media placement, prompt payloads, and generation state.
- Workflow owns `WorkflowNode`, `WorkflowEdge`, node config, node run state, and local workflow persistence.
- CLI/shadow runtime has its own file-state bridge expectations.
- Prompt references, workflow edges, and provider media slots are related concepts but are not one data model.

This causes drift: a Canvas image can be changed without a Workflow node knowing; a Workflow prompt can reference media without Canvas-level relation lines knowing; a provider request can need both graph edges and prompt mentions.

## Decisions Confirmed

1. Full migration is required. Existing Canvas elements and existing Workflow nodes/edges must be migrated into the unified runtime.
2. One `UnifiedProjectRuntime` is the source of truth.
3. Every Workflow node corresponds to a unified entity.
4. Canvas defaults to showing visual entities only, with an optional technical-node overlay mode.
5. Workflow edges, prompt mentions, media slots, and Canvas relation lines are all one connection model.
6. Prompt mention synchronization is bidirectional:
   - Typing or removing `@entity` updates runtime connections.
   - Slot/connection bindings are visible in the prompt UI, but media slots do not forcibly rewrite raw prompt text in v1.
7. Canvas and Workflow share the same prompt composer capability.
8. Canvas rendering migrates to Konva.
9. Workflow migrates its node shell, ports, selection, media previews, and edges to Konva, while keeping prompt bars, inspectors, menus, and complex controls as DOM overlays.

## External Technical Basis

- Konva's official performance guidance emphasizes reducing stage size, using layers carefully, caching complex shapes, disabling listening where possible, and optimizing animations. This supports a layered editor renderer rather than a single giant React/SVG tree.
- Konva's video guidance uses `HTMLVideoElement` as a source for a Konva image and redraws a layer during playback. This means video performance still requires a scheduler; moving to Konva alone is not enough.
- `HTMLVideoElement.requestVideoFrameCallback()` is the right browser API for syncing canvas updates to actual decoded video frames where supported.
- WebCodecs is a lower-level option for a future advanced decode/frame pipeline, not a v1 requirement.
- React Flow remains a useful reference for graph UI ergonomics, but Flovart should not adopt it as the core runtime model because the Canvas and Workflow must share one media/generation entity model.

Reference links:

- https://konvajs.org/docs/performance/All_Performance_Tips.html
- https://konvajs.org/docs/sandbox/Video_On_Canvas.html
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
- https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- https://reactflow.dev/learn/advanced-use/performance

## Unified Runtime Model

Introduce one project object:

```ts
export interface UnifiedProjectRuntime {
  version: 1;
  projectId: string;
  entities: Record<string, RuntimeEntity>;
  connections: Record<string, RuntimeConnection>;
  canvasView: CanvasViewState;
  workflowView: WorkflowViewState;
  jobs: Record<string, GenerationJobRecord>;
  assets: AssetLibrary;
  settings: RuntimeProjectSettings;
  updatedAt: number;
}
```

Runtime entity:

```ts
export type RuntimeEntityKind =
  | 'image'
  | 'video'
  | 'text'
  | 'shape'
  | 'path'
  | 'arrow'
  | 'line'
  | 'group'
  | 'llm'
  | 'generator'
  | 'imageGen'
  | 'videoGen'
  | 'videoEdit'
  | 'httpRequest'
  | 'condition'
  | 'switch'
  | 'merge'
  | 'template'
  | 'upscale'
  | 'faceRestore'
  | 'bgRemove'
  | 'saveToCanvas'
  | 'saveToAssets'
  | 'preview'
  | 'loadImage'
  | 'loadVideo';

export interface RuntimeEntity {
  id: string;
  kind: RuntimeEntityKind;
  name?: string;
  media?: RuntimeMedia;
  promptPayload?: AdaptivePromptPayload;
  generationState?: ElementGenerationState;
  provider?: string;
  modelId?: string;
  apiKeyRef?: string;
  params?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
```

Canvas and Workflow view state store presentation only:

```ts
export interface CanvasViewNode {
  entityId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  zIndex: number;
  visible: boolean;
  locked?: boolean;
  parentId?: string;
}

export interface WorkflowViewNode {
  entityId: string;
  nodeKind: RuntimeEntityKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  collapsed?: boolean;
}
```

No business data lives in the view records. If a prompt, model, API key, generation job, or media URL changes, it changes on `RuntimeEntity`.

## Unified Connections

All graph-like relationships use `RuntimeConnection`:

```ts
export type RuntimeConnectionKind =
  | 'workflow_edge'
  | 'prompt_reference'
  | 'media_slot'
  | 'canvas_relation'
  | 'control_flow';

export type RuntimeConnectionRole =
  | 'reference'
  | 'first_frame'
  | 'last_frame'
  | 'style_ref'
  | 'control_net'
  | 'source_video'
  | 'mask'
  | 'result'
  | 'true'
  | 'false'
  | 'default';

export interface RuntimeConnection {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  kind: RuntimeConnectionKind;
  role?: RuntimeConnectionRole;
  sourcePort?: string;
  targetPort?: string;
  createdBy: 'canvas' | 'workflow' | 'prompt' | 'migration' | 'cli';
  createdAt: number;
}
```

UI names can differ:

- Canvas calls them references, relation lines, or slots.
- Workflow calls them edges.
- Provider request builders call them inputs.

The resolver sees one connection graph.

## Prompt Composer Unification

Current `InlinePromptBar` should stop depending directly on `CanvasElement`. It should consume a generic prompt target:

```ts
export interface PromptComposerTarget {
  entity: RuntimeEntity;
  mode: 'image' | 'video' | 'text';
  status: ElementGenerationState['status'];
  progress?: number;
  availableReferences: RuntimeEntity[];
  connections: RuntimeConnection[];
}
```

Adapters:

- `createCanvasPromptTarget(runtime, entityId)`
- `createWorkflowPromptTarget(runtime, entityId)`

Both adapters feed the same `InlinePromptBar` and `PromptBar`.

Prompt sync rules for v1:

1. Typing an `@entity` mention creates or updates a `prompt_reference` connection.
2. Removing an `@entity` mention removes the corresponding prompt-created connection unless another UI-owned connection still uses it.
3. A media slot connection appears in the prompt UI's slot/attachment area.
4. Media slot connections do not forcibly mutate raw prompt text.
5. Workflow edges remain graph edges and do not insert text mentions.

## Rendering Architecture

Create shared rendering primitives:

```txt
components/scene/
  SceneStage.tsx
  SceneViewportController.ts
  SceneMediaNode.tsx
  SceneVideoScheduler.ts
  SceneSelectionLayer.tsx
  SceneConnectionLayer.tsx
```

Canvas view:

```txt
CanvasWorkspace
  DOM chrome
  Konva SceneStage
    media layer
    shape/text layer
    relation/connection layer
    selection/transformer layer
  DOM overlays
    InlinePromptBar
    toolbars
    context menus
```

Workflow view:

```txt
WorkflowWorkspace
  DOM chrome
  Konva SceneStage
    workflow group/background layer
    connection layer
    node shell layer
    port/selection layer
    media preview layer
  DOM overlays
    InlinePromptBar
    inspector
    node library
    saved workflow panel
    menus
```

Workflow node shell moves to Konva:

- node rect
- header
- title text
- port dots
- selected state
- hover affordances
- media preview
- pinned output badge

Workflow complex controls stay DOM:

- prompt editor
- model select
- API key select
- inspector fields
- context menus
- template panels

## Video Performance Requirements

Konva is necessary but not sufficient. The video path must include:

1. A `SceneVideoScheduler` that controls which video-backed nodes actively redraw.
2. Poster/frame fallback for offscreen videos.
3. Visibility culling using viewport bounds.
4. Playback budget, for example only selected/visible/playing videos redraw.
5. During pan/zoom/drag, pause or reduce video redraw frequency.
6. Use `requestVideoFrameCallback()` when available, falling back to `requestAnimationFrame`.
7. Layer separation so video redraws do not repaint all UI controls.
8. No React state updates per video frame.

Target v1 envelope:

- Smooth Canvas interaction with up to 200 mixed entities.
- Multiple 1080p videos can exist locally.
- Only a limited active subset should decode/redraw at full rate.
- Non-active videos display poster/current frame cache.

## Migration Strategy

Create a deterministic migration pipeline:

```txt
legacy canvas elements
legacy workflow nodes/edges
legacy saved workflows
legacy generation state
legacy prompt payloads
legacy CLI shadow state
        -> migrateToUnifiedRuntime()
        -> normalizeRuntimeConnections()
        -> save UnifiedProjectRuntime
```

Rules:

1. Canvas element id should become entity id when possible.
2. Workflow nodes get entity ids. If a Workflow node clearly points to an existing Canvas media element, merge by entity id rather than duplicating.
3. Workflow `node.config.prompt` becomes `entity.promptPayload.rawText` if no richer payload exists.
4. Workflow `node.config.model/provider/apiKeyRef/aspectRatio/resolution/durationSec` moves into entity model/provider/params.
5. Canvas `generationState` survives unchanged on entity where compatible.
6. Workflow edges become `workflow_edge` connections and pass through connection normalization.
7. Prompt resolved references become `prompt_reference` connections.
8. Existing Canvas relation lines become `canvas_relation` connections if present.
9. Saved workflow templates migrate to view templates referencing entity shapes, not duplicated business data.

Migration must be idempotent. Running it twice should not duplicate entities or connections.

## CLI and Bridge Compatibility

Existing commands should continue to work through adapters:

- `canvas.inspect` reads `runtime.entities + runtime.canvasView`.
- `workflow.inspect` reads `runtime.entities + runtime.workflowView + runtime.connections`.
- `element.create` creates a runtime entity plus a Canvas view node.
- `workflow.load/update/run` modifies workflow view and unified connections.
- `element.ignite` and `generate.video/image` write entity generation state and job records.

Provider-backed generation still uses browser-held keys. The runtime must not expose API keys in CLI output.

## Store Boundaries

Recommended store split:

```txt
useRuntimeStore
  UnifiedProjectRuntime
  entity CRUD
  connection CRUD
  migration
  persistence

useCanvasViewStore
  selected entity ids
  viewport
  transform handles
  technical overlay toggle

useWorkflowViewStore
  selected workflow entity ids
  viewport
  pending connection
  selection box
  run scope

useGenerationStore
  jobs
  polling
  recovery
  entity status sync

useProviderStore
  model registry
  provider readiness
```

Runtime data must not be duplicated into the view stores.

## Implementation Phases

### Phase 1: Runtime Types and Migration

Add unified runtime types, migration tests, and read-only adapters from legacy state.

### Phase 2: Runtime Store

Introduce `useRuntimeStore` and persistence. Keep legacy UI running through adapter selectors.

### Phase 3: Shared Prompt Target

Refactor `InlinePromptBar` to generic prompt targets. Canvas and Workflow both use it.

### Phase 4: Workflow Uses Runtime Entities

Workflow store stops owning business data. It owns only workflow view data and uses runtime entities for prompts, media, providers, and generation state.

### Phase 5: Canvas Uses Runtime Entities

Canvas state moves to runtime entities plus canvas view nodes.

### Phase 6: Konva Canvas Renderer

Replace main Canvas content rendering with Konva while keeping DOM overlays.

### Phase 7: Konva Workflow Shell

Move Workflow node shells, ports, media preview, and edges to Konva. Keep complex controls as DOM overlays.

### Phase 8: CLI and Bridge Migration

Update Flovart CLI and shadow runtime to read/write unified runtime.

### Phase 9: Cleanup

Remove legacy duplicated stores, localStorage keys, and transitional adapters after migration coverage is stable.

## Testing and Acceptance Criteria

Required tests:

1. Legacy Canvas elements migrate to entities and Canvas view nodes.
2. Legacy Workflow nodes migrate to entities and Workflow view nodes.
3. Legacy Workflow edges become normalized runtime connections.
4. Prompt mentions create prompt reference connections.
5. Removing prompt mentions removes prompt-created connections.
6. Workflow node prompt uses the same PromptBar behavior as Canvas InlinePromptBar.
7. `element.ignite` updates the same entity visible in Canvas and Workflow.
8. `workflow.run` reads entity prompt/model/provider state.
9. CLI inspect commands do not expose API keys.
10. Runtime migration is idempotent.
11. Canvas technical overlay can show hidden workflow entities.
12. Konva renderer can render image/video/text/shape and workflow shells without React frame churn.

Manual acceptance:

- A media entity created on Canvas appears as a usable Workflow node.
- A Workflow image/video node result appears on Canvas without duplicating business state.
- Changing prompt/model/API key in Workflow changes the same entity used by Canvas.
- Canvas can hide or reveal technical workflow entities.
- A project with old localStorage state opens and migrates without data loss.

## Non-Goals for v1

- Full PixiJS renderer.
- WebCodecs custom decoding pipeline.
- Rendering every DOM control inside Konva.
- Real-time multi-user collaboration.
- Removing all legacy code in the first implementation phase.

## Open Risks

1. Existing `App.tsx` owns too much Canvas behavior. The implementation plan must avoid a giant one-shot rewrite.
2. Video performance depends on decode limits, not only renderer choice.
3. CLI and browser runtime must agree on migration versioning.
4. Prompt mention conflicts need narrow v1 rules to prevent surprising raw text changes.
5. Full migration can expose previously invalid workflow edges; normalization must be conservative and deterministic.
