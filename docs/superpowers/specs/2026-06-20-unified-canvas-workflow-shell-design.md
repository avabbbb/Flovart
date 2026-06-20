# Canvas / Workflow Unified Shell Design

## Goal

Unify Canvas and Workflow under one Flovart application shell inspired by the menu layout of `basketikun/infinite-canvas`, while retaining Flovart's existing visual language, provider layer, local persistence, CLI/MCP bridge, and separate Canvas/Workflow domain data.

## Product Structure

Both surfaces use the same four-part shell:

1. A top menu with the Flovart logo, current surface/project identity, Canvas/Workflow switch, project/file actions, theme, language, and settings.
2. A bottom tool dock whose available tools are supplied by the active surface.
3. A left sliding drawer for boards/projects and layers/nodes.
4. A right sliding, resizable drawer with Agent, generation history, and asset library tabs.

The shell is shared. Canvas and Workflow provide adapters. Their stores remain separate.

## Shared Chrome

### Top Menu

- Flovart logo and product name on the left.
- Canvas / Workflow one-click switch.
- Current board or Workflow project title.
- Contextual project actions such as create, rename, duplicate, import, and export.
- Theme, language, and settings actions on the right.

It must not duplicate actions already owned by the bottom tool dock.

### Bottom Tool Dock

The existing Canvas vertical toolbar is replaced by a bottom-centered dock. The dock owns layout only; each surface supplies tool definitions and callbacks.

Canvas supplies selection, pan, drawing, shape, text, upload, crop confirmation, undo, redo, layers, assets, and settings actions. Workflow supplies selection, pan, text/image/video/audio/config node creation, shared media, undo, redo, fit view, and grid actions.

### Left Sliding Drawer

The existing `WorkspaceSidebar` sliding behavior is preserved: hidden off-screen when closed and restored with one action.

- Canvas top section: boards. Bottom section: Canvas layers.
- Workflow top section: Workflow projects. Bottom section: Workflow nodes as layers.
- Both layer lists support selection, rename, visibility, lock, and drag reorder.
- Workflow node order is the rendering Z order.
- Hidden Workflow nodes and their attached connections are not rendered.
- Locked Workflow nodes remain selectable from the drawer but cannot be moved, resized, deleted, or edited until unlocked.

Workflow adds `isVisible` and `isLocked` to its node model. No legacy compatibility path is required.

### Right Sliding Drawer

The existing `RightPanel` behavior is preserved:

- Closed state exposes a compact open button.
- Open and close use the current sliding animation.
- Width remains pointer-resizable and locally persisted.
- Tabs remain Agent, History, and Assets.

The right drawer becomes a shared visual shell with domain adapters:

- Canvas Agent dispatches Canvas runtime commands.
- Workflow Agent dispatches Workflow online/local Agent, CLI, and MCP commands.
- Canvas history/assets create Canvas elements.
- Workflow history/assets create Workflow media nodes at the viewport center or drop position.

## Agent Design

The Agent UI follows the referenced project's compact menu/chat presentation but keeps Flovart's theme tokens and the current right-drawer layout.

The shared Agent presentation includes:

- Conversation and history views.
- Composer, attachments, streaming messages, tool result cards, progress, stop, and confirmation states.
- A small runtime/mode menu rather than a separate setup-heavy visual surface.

Execution remains domain-specific:

- Canvas uses the existing Flovart Runtime atomic command path.
- Workflow keeps website Provider execution plus the local Codex/CLI/MCP bridge.
- API keys remain browser-local and are never copied into project data or Agent logs.

## Workflow Feature Parity

Workflow receives the Canvas UI capabilities that are meaningful for nodes:

- Shared assets and generation history browsing, dragging, and insertion.
- Layer selection, rename, visibility, lock, and ordering.
- ElementBar actions for copy, prompt edit, run/stop, download, save to assets, replace media, crop, filters, upscale, remove background, outpaint, mask, split layers, reverse prompt, free resize, align, Z order, and delete.
- Multi-selection alignment and ordering.

Canvas-only drawing properties and shape/text controls are not displayed for Workflow node types that do not support them.

## Component Boundaries

- `StudioTopMenu`: shared top menu presentation.
- `StudioBottomDock`: shared bottom toolbar presentation driven by action descriptors.
- `StudioLeftDrawer`: shared drawer shell with Canvas and Workflow content adapters.
- `StudioRightDrawer`: extracted sliding/resizing/tab shell from the current `RightPanel`.
- `CanvasStudioAdapter`: exposes Canvas boards, layers, tools, Agent, history, and assets.
- `WorkflowStudioAdapter`: exposes Workflow projects, nodes, tools, Agent, history, and assets.

Existing domain components remain responsible for business logic. Shared Chrome components must not import Canvas or Workflow stores directly.

## State And Persistence

- Shell open/closed state and right width remain small local UI preferences.
- Canvas boards/elements continue using current Canvas persistence.
- Workflow projects/nodes continue using the Workflow Zustand/localforage store.
- Generation history and asset library keep their existing local stores and are exposed to both adapters.
- Switching surfaces preserves each surface's current selection, viewport, active project, drawer state, and Agent session.

## Failure Handling

- An unavailable Agent backend disables send and shows the relevant setup message without hiding history/assets.
- Missing Workflow media keeps the existing recoverable node state.
- Unsupported ElementBar actions are omitted rather than rendered as dead buttons.
- Hidden or locked nodes are validated at both the UI callback and Workflow operation boundary.

## Acceptance Criteria

- Canvas and Workflow visibly share the same top menu, bottom dock, left drawer, and right drawer.
- Both left and right drawers open and close with one action; the right drawer remains resizable.
- Flovart logo is visible in the top menu.
- Canvas retains boards/layers, history, assets, Agent, and existing generation behavior.
- Workflow exposes projects/nodes, history, assets, Agent, and applicable ElementBar actions.
- Workflow layer visibility, locking, rename, and reorder affect the actual canvas behavior.
- Assets and history create content in the active surface, never the inactive one.
- Canvas and Workflow provider/data stores remain separate.
- The existing Canvas/Workflow switch remains one click.

## Verification Scope

Add focused component and interaction tests for shell switching, drawer behavior, Workflow layer operations, right-panel insertion routing, Agent adapter routing, and Workflow ElementBar actions. Per project convention, implementation work will not run tests, syntax checks, or builds; the user will execute verification.

## Non-Goals

- Merging Canvas and Workflow stores.
- Replacing the provider layer.
- Replacing CLI/MCP command contracts.
- Copying reference-project branding or data architecture.
- Adding cloud sync or migrating existing local data.
