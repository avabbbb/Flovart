# Other hosts

Read this only when the task names one of these hosts. Everything in the main
SKILL still applies.

## Optional local MCP projection (Iris)

The five stable operations are also available through Iris's optional local
stdio MCP projection, for MCP-capable hosts such as TeleAgent:
`flovart_status`, `flovart_workflow_inspect`, `flovart_workflow_selection`,
`flovart_workflow_apply` and `flovart_workflow_run`.
The Agent video pipeline commands are projected there too, as
`flovart_pipeline_run_start`, `flovart_capture_ui`, `flovart_composition_render`
and so on (see `commands/pipeline.md`).

It is a transport for the same Workflow, not a second runtime, and separate
from any creative host's native MCP. Codex, Claude Code, OpenCode and
WorkBuddy's CLI Connector use the CLI unless that host has a separately
certified MCP integration. Do not configure an MCP server yourself.

## DaVinci Resolve

Use Resolve Studio's own native MCP for host context and project operations;
do not create or configure a second Resolve MCP server. The normal Workflow
operations do not write a Runtime artifact to a file Resolve can import: do
not infer a file path from a task or artifact ID, call private Runtime
endpoints, or report a Media Pool import from a task result alone.

### Resolve Studio 21.1: no-provider Media Pool tracer

Use this only for the Resolve R0/R1 host-validation task. Resolve owns
project, timeline, selection and Media Pool state. The Flovart CLI owns the
local deterministic fixture task and its durable Artifact.

First verify the installed product is Resolve Studio 21.1 and that its native
MCP is connected to the same local Resolve instance. Discover tool names and
the current API through that MCP; do not guess from another version. If 21.1
or the native MCP is unavailable, stop and report the exact host gate instead
of presenting a mock as Resolve evidence.

1. Through Resolve's MCP, read the current project, timeline and selected
   clip. Keep their identities and the timeline state; recheck them before a
   Resolve write. If the selection changes, stop instead of retargeting.
2. Submit the fixed local fixture with one unique idempotency key:

   ```bash
   flovart runtime.test.fixture-image --idempotency-key <unique-key> --json
   ```

   If submission status is unknown, retry with the same key, never a new one.
3. Poll with `flovart task.get --task-id <taskId> --json` until completed.
   Stop on failure or cancellation.
4. Resolve the file immediately before import:

   ```bash
   flovart artifact.locate --task-id <taskId> --json
   ```

   The result is a local path with the verified MIME type, byte size and
   SHA-256. Use the path only for the immediate import; do not write it into
   project metadata.
5. Import through a bounded Media Pool operation of Resolve's MCP into a
   root-level bin named `Flovart Candidates` (create it with
   `MediaPool.AddSubFolder(root, "Flovart Candidates")` if missing, make it
   current with `SetCurrentFolder`, then restore the user's previous folder).
   Never rename, move or delete existing bins. Do not add the fixture to the
   Timeline, replace a clip, delete or overwrite media, or run unrestricted
   scripts. If there is no safe bounded import path, stop and report the gap.
6. Re-read the Media Pool and Timeline. Confirm the item is in the Media Pool
   and the Timeline is unchanged.

`runtime.test.fixture-image` imports the repository's fixed
`public/favicon.png`. It verifies the local task-to-file handoff only; it is
not AI generation and does not use the selected clip. Never describe it as a
generated scene or as a completed real-host tracer until Resolve visibly
accepts the file and the Timeline comparison passes.
