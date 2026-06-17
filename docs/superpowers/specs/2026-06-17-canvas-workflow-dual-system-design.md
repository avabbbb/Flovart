# Canvas And Workflow Dual-System Design

## Goal

Restore Flovart Canvas to the current `59256af` behavior before the uncommitted media-node connection work, then replace the legacy Workflow implementation with an isolated editor adapted from `basketikun/infinite-canvas` at reference commit `8cbe00e`. Canvas and Workflow remain separate products while sharing Flovart's provider configuration, assets, generation history, and command runtime.

## Product Boundary

- Canvas has no workflow ports, persisted connections, or media-node graph behavior.
- Preserve the existing Canvas/Workflow one-click switch and current Canvas prompt, SD2, provider, asset, history, and generation behavior.
- Workflow owns independent projects, nodes, connections, selection, viewport, and undo history persisted through `localforage`.
- Workflow supports image, text, video, and generation-config nodes. Audio nodes are out of scope.
- Each node runs independently. Connections pass upstream prompt and media references; there is no whole-graph run action.
- Successful generation creates and connects a new result node instead of replacing the source node.
- The reference project's Next.js shell, standalone API configuration, and duplicate provider implementation are not imported.

## Canvas Rollback

The rollback is selective because the worktree contains unrelated user changes.

- Remove uncommitted media-node rendering and connection components, hooks, utilities, tests, and plans.
- Remove only the associated hunks from mixed files such as `App.tsx`, generation hooks, canvas interaction, board types, history state, and Agent context.
- Restore the Canvas behavior represented by `59256af` without reverting unrelated Agent, storage, Docker, documentation, or cleanup changes.
- Keep `activeView` and the shared workspace switch required to enter the new Workflow editor.

## Workflow Editor

The new editor is an isolated Workflow module adapted to Flovart's Vite application.

- Independent multi-project list with create, rename, delete, and switch actions.
- Infinite pan and zoom, grid, fit/reset view, minimap, and zoom controls.
- Node drag, resize, box select, multi-select, copy, delete, context menu, and undo/redo.
- File import for image and video nodes, text nodes, config nodes, connection handles, connection selection, and deletion.
- Node prompt/configuration surfaces use Flovart theme tokens and current provider/model selectors.
- The reference layout and interaction structure are retained while visual tokens and dark mode follow Flovart.
- Required reusable dependencies may be added, including Ant Design, Lucide, Motion, nanoid, and localforage. Next.js runtime dependencies are excluded.

## Data And Provider Integration

Workflow data is independent from Canvas `Board` and `Element` data. Shared services are exposed through narrow adapters:

- provider/model capability adapter;
- asset read/import adapter;
- generation history writer;
- image/video/text generation adapter;
- command dispatcher adapter.

A shared generation capability schema becomes the source of truth for supported modes and model parameters. Workflow config nodes consume it directly. Canvas PromptBar keeps its current interface while using the same schema where applicable. Unsupported provider options are disabled with a clear reason.

Generation resolves explicit node references and connected upstream nodes, invokes the current Flovart provider path, records real status and errors, writes the existing generation history, and creates a new connected result node on success.

## Agent, CLI, And MCP

Flovart's `COMMAND_REGISTRY` remains the only command contract.

- The online Agent continues to use the current Flovart provider and chat path.
- The local Agent adopts the reference project's Connect, Chat, History, Logs, structured streaming, attachment, and tool-confirmation experience.
- A loopback bridge listens only on `127.0.0.1`, authenticates with a token, and binds the first authorized browser Origin.
- The browser synchronizes a compact Workflow snapshot over HTTP and receives tool calls and Agent events over SSE.
- The MCP server uses the official SDK over stdio and forwards registered Flovart commands to the same loopback bridge.
- Codex `app-server --stdio` thread events feed the local Agent UI. Mutating tool calls still require browser confirmation.
- CLI, online Agent, local Agent, and MCP all invoke the same browser Workflow dispatcher and return normalized command results.
- Existing CLI commands remain supported. Workflow project, node, connection, selection, viewport, config, and generation commands are added to the registry.

Agent snapshots include stable IDs, node metadata, connections, selection, viewport, and generation state. They exclude API keys, full media payloads, and local file paths.

## Error Handling

- Invalid or unsupported connections do not mutate Workflow state.
- Provider failures leave source/config nodes intact and expose retryable error state.
- Generation results are committed only after provider success.
- Agent disconnects, SSE reconnects, command timeouts, and stale requests do not block local editing.
- Command IDs and idempotency guards prevent transport retries from duplicating nodes or generations.
- Missing local media preserves an interactive node shell with an explicit error.

## Legacy Removal

Remove legacy Workflow components, stores, engines, adapters, tests, and dead assets. Retain only genuinely shared workspace state such as the Canvas/Workflow view switch. Do not add migration or compatibility logic for old Workflow graph data.

The imported implementation must retain upstream attribution and AGPL-3.0 notices. Both repositories currently use AGPL-3.0.

## Verification And Acceptance

- Canvas contains no node handles, graph connections, or connection persistence and otherwise preserves current behavior.
- Workflow projects persist independently and support the agreed editor interactions.
- Image, text, video, and config nodes resolve upstream references correctly.
- Generation creates a new connected result node and updates existing status/history surfaces.
- Provider capability filtering is identical between shared configuration consumers.
- Equivalent CLI, Agent, and MCP mutations produce equivalent dispatcher results.
- Local bridge token, Origin binding, confirmation, timeout, and redaction behavior are covered by focused tests.
- Documentation todo and pending-test files reflect the actual delivered scope.

Per project instructions, implementation may add focused tests but does not run syntax checks, tests, or builds; the user performs runtime verification.

## Delivery Order

1. Selectively restore Canvas and remove the uncommitted connection implementation.
2. Replace legacy Workflow with the isolated editor and local persistence.
3. Integrate shared provider capabilities and node generation.
4. Add the unified local Agent, CLI, and MCP bridge.
5. Remove residue, update documentation, and prepare user verification notes.
