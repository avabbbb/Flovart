# Workflow Full-Port Correction Design

## Decision

Replace the current simplified `components/workflow/` editor with a coherent port of `basketikun/infinite-canvas` at commit `8cbe00e3486eec00bcaf21a7c5e55fefddf28500`. The reference interaction model and UI modules are the implementation baseline. Flovart keeps ownership of persistence, provider selection, generation history, assets, the Canvas/Workflow switch, CLI, Agent, and MCP command execution.

This design supersedes the reduced Workflow editor sections of the 2026-06-17 dual-system design and plan. Canvas remains a separate product and is not merged into Workflow.

## Root Cause

The previous implementation recreated a small graph editor from a feature summary instead of porting the reference editor as a complete subsystem. It implemented project persistence, basic nodes, viewport movement, and provider adapters before the reference interaction controller and node overlays were present. As a result, the editor looked structurally similar while omitting core product behavior.

The current simplified Workflow UI is replacement code, not a compatibility target. Its visual components, event coordinator, and partial node/config surfaces will be deleted or rewritten. Shared Flovart adapters may be retained only when the new port actually consumes them.

## Source And Adaptation Boundary

Port and adapt these reference module families as one unit:

- infinite canvas viewport, pan, zoom, background, selection, and keyboard interactions;
- node rendering for text, image, video, audio reference, and generation configuration;
- connection rendering, hit testing, drag state, target detection, and empty-drop creation menu;
- node hover toolbar, prompt/config panel, context menu, minimap, project shell, and asset picker;
- clipboard, undo/redo, direct media drop, media inspection, upload replacement, and node sizing;
- online/local Agent panel interaction, session history, logs, attachments, confirmations, and streaming events;
- reference graph operations used by the Agent and CLI bridge.

Do not port the reference Next.js routing shell, server API routes, authentication, independent API-key configuration, WebDAV implementation, or duplicate provider clients. Replace those boundaries with Flovart adapters.

Preserve upstream attribution and AGPL-3.0 notices for copied or adapted source families.

## Required Interaction Parity

### Canvas Surface

- Cursor-centered wheel zoom and pointer/space/middle-button panning.
- Click, additive click, box selection, multi-node drag, resize, delete, copy/paste, undo/redo, fit view, minimap, and background modes.
- Directly dropping image, video, or audio files creates correctly sized nodes at the pointer's world position.
- Toolbar import and replacing media in an existing node use the same media ingestion path as direct drop.
- Pasted image files and text create nodes through the same operation layer.
- Double-clicking empty space opens the node creation menu at that world position. This is a Flovart requirement added on top of the reference snapshot, whose double-click behavior only edits text/title content.

### Nodes And Overlays

- Clicking a node selects it and reveals a node action toolbar above it.
- Image/video/text/config nodes reveal a prompt/config surface below the selected node when applicable.
- Flovart's current PromptBar behavior, provider/model choices, mentions, status, retry, and generation history semantics remain authoritative.
- Flovart's current ElementToolbar actions and visual language remain authoritative. Workflow supplies an adapter for node geometry and node operations instead of duplicating a second unrelated toolbar.
- Overlay scale remains constant on screen while its position follows the node and viewport.
- Pointer events inside toolbars, prompts, media controls, and dialogs never initiate node drag or canvas pan.
- Loading, success, error, stop, and retry states remain visible on the source/config node; successful output is added as a new connected result node.

### Creating From A Node

- Dragging a source handle onto a valid existing target creates a connection.
- Dragging a source handle into empty space opens the reference-style creation menu at the drop position.
- Choosing text, image, video, audio reference, or config creates the node, connects it to the source, selects it, and opens the relevant prompt/config surface.
- Invalid, duplicate, self, and config-to-config connections do not mutate state and show a concise reason.
- Closing the creation menu cancels the pending connection without leaving placeholder data.

## Data Model And Persistence

Workflow projects remain independent from Canvas boards. The reference node and connection contracts become the canonical Workflow model, extended only with Flovart generation identifiers and provider metadata needed by shared services.

Persist Workflow projects, media metadata, viewport, selection-independent project state, sessions, and background settings with `localforage`. Do not add legacy Workflow migration because the product is not released and the user requested replacement. Avoid `localStorage` for nodes, media, sessions, histories, or large JSON.

Media ingestion stores durable data through the existing Flovart browser media/storage path. Object URLs may be used for immediate preview but are not persisted as the only media location.

All UI, CLI, Agent, and MCP mutations call the same pure Workflow operation layer. The store owns persistence and subscriptions; components do not maintain competing canonical graph copies.

## Provider And Generation Integration

- Keep current Flovart API keys, provider routing, model references, capability checks, and `executeUnifiedIgnition`/text generation paths.
- Prompt/config panels read current Flovart model options and capability restrictions instead of importing the reference provider configuration.
- Incoming text nodes contribute prompt context. Incoming image, video, and audio reference nodes contribute only slots supported by the selected model/provider.
- Generation updates the initiating node to loading, supports cancellation, surfaces the provider error unchanged where safe, and supports retry.
- A successful request creates a new typed result node, connects it to the initiating node, records generation history, and keeps upstream nodes unchanged.
- API keys and full media payloads are never included in Agent snapshots, logs, or routine CLI/MCP responses.

## Agent, CLI, And MCP Integration

The reference Agent experience is ported, but Flovart's command registry remains the only mutation contract.

- Online Agent uses the existing Flovart orchestration/provider path.
- Local Agent keeps Connect, Chat, History, Logs, attachments, thread resume, structured streaming, tool previews, confirmation, and command-result behavior.
- CLI and MCP commands dispatch to the active browser Workflow operation layer through the authenticated loopback bridge.
- Equivalent UI, Agent, CLI, and MCP commands produce the same graph changes and normalized results.
- Mutating Agent/MCP calls require confirmation and idempotency protection; read-only inspection is redacted.

## Component Shape

The port may keep reference file boundaries where they represent real behavior. Expected modules include the surface coordinator, node renderer, connections, node toolbar, prompt panel, config composer, creation menu, context menu, minimap, project shell, asset picker, Agent panel, and graph utilities.

Avoid a second abstraction layer whose only purpose is renaming reference components. Adapt imports, framework APIs, theme access, storage, and generation boundaries directly. Shared Flovart PromptBar/ElementToolbar behavior may be extracted into reusable internals where necessary so Canvas and Workflow render the same product controls without forcing SVG-only wrappers into the DOM Workflow surface.

## Removal Boundary

- Delete or rewrite the current simplified `InfiniteWorkflow`, `WorkflowNode`, `WorkflowToolbar`, config panel, minimap, context menu, project shell, and Workflow-only CSS.
- Remove tests that assert reduced behavior such as cancelling an empty connection drop or excluding reference node types.
- Keep the Workflow store, operation reducer, provider adapter, dispatcher, loopback bridge, and command metadata only after reviewing and adapting them to the canonical ported model.
- Do not change unrelated Canvas, Docker, logo, documentation, or user worktree changes.

## Error Handling

- Unsupported files are ignored with a visible message; supported file failures leave no broken persisted node.
- Missing durable media renders an interactive error shell with replace/remove actions.
- Provider failure never deletes or replaces source nodes.
- Stale generation responses cannot overwrite a newer run for the same node.
- Agent disconnects and command timeouts do not block local editing.
- Undo/redo records one snapshot per completed gesture or operation, not per pointer move.

## Acceptance Criteria

1. Empty-space double-click opens node creation at the clicked world position.
2. Dropping image/video files onto the surface creates playable/viewable nodes without using the toolbar file picker.
3. Selecting applicable nodes visibly renders Flovart PromptBar and ElementToolbar behavior in stable screen-space positions.
4. Dragging from a node to empty space opens the create-and-connect menu; choosing a type creates, connects, selects, and opens the new node.
5. Reference project interactions listed above are present, not represented by inert placeholders.
6. Prompt/model/provider changes use current Flovart state and produce the same request routing as Canvas.
7. Successful image/video/text generation creates a connected result, generation history, and visible status; failure and retry remain on the initiating node.
8. Online Agent, local Agent, CLI, and MCP inspect and mutate the same active Workflow project through one command layer.
9. Canvas and Workflow remain independently persisted and switchable with one action.
10. Old simplified Workflow UI code and contradictory tests have no live imports.

Per repository instructions, focused tests may be written but Codex does not run syntax checks, tests, builds, or compilation. Runtime verification is performed by the user after static implementation review and documentation updates.

## Delivery Sequence

1. Replace the surface controller and canonical node/connection model.
2. Port direct media ingestion, clipboard, history, and creation interactions.
3. Port node toolbar, prompt/config overlays, and node-specific tools.
4. Bind provider execution, cancellation, result nodes, history, and assets.
5. Port and bind Agent UI, then reconcile CLI/MCP operations with the canonical model.
6. Remove simplified residue, add attribution, and update todo/pending-test documentation.
