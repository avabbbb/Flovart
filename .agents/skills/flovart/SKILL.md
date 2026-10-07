---
name: flovart
description: Use Iris's visible Workflow through its stable Agent surface. Use when an agent must prepare the workspace, inspect the current graph, read selection, apply document changes, or run a Workflow node.
---

# Iris

Iris is the visible Workflow authority. The Link layer prepares the local
session automatically. Do not ask the user for connection details and do not
recreate a connection flow in the conversation.

This Skill expects Node.js 22.19.0 or newer when the local CLI is run.

## Normal loop

Start every new task with:

```bash
flovart ensure --json
flovart workflow.inspect --agent-identity codex --json
```

When working directly from this source checkout, use the repository entrypoint
if the packaged `flovart` command is not installed:

```bash
npm run flovart:cli -- ensure --json
npm run flovart:cli -- workflow.inspect --agent-identity codex --json
```

Do not use `npx flovart-cli` as an automatic fallback; an unpublished source
checkout can make `npx` query an unrelated registry package.

Use only the stable Workflow surface for normal work:

Use `ensure` as the bootstrap command. The five stable task operations are
`status`, `workflow.inspect`, `workflow.selection.get`, `workflow.apply`, and
`workflow.node.run`.

```text
flovart ensure
flovart status
flovart workflow.inspect
flovart workflow.selection.get
flovart workflow.apply
flovart workflow.node.run
```

The same five operations are available through the optional local stdio MCP
projection for MCP-capable hosts such as TeleAgent. The MCP names are
`flovart_status`, `flovart_workflow_inspect`, `flovart_workflow_selection`,
`flovart_workflow_apply`, and `flovart_workflow_run`. MCP is a transport
projection, not a second Workflow runtime; use the CLI path for Codex,
Claude Code, OpenCode, and WorkBuddy's CLI Connector unless that host has a
separately certified MCP integration.

Before a change, read the real `projectId`, object IDs, and revision from
`workflow.inspect`. Read `workflow.selection.get` when the request depends on
the current selection. Group related graph edits into one `workflow.apply`.
Pass the returned project and revision as preconditions, and use a stable
`mutationId` and `idempotencyKey` for every write or run.
After a write, inspect again. If a command fails, preserve its structured error
code, inspect before retrying, and stop safely when the visible workspace is
unavailable or the target/revision changed. Never choose another project or
retry a mutation with a new identity.

## Resolve Studio 21.1 — no-provider Media Pool tracer

Use this path only for the Resolve R0/R1 host-validation task. Resolve owns
project, timeline, selection, and Media Pool state. Flovart CLI owns the local
deterministic fixture task and its durable Artifact.

Before starting, verify the installed product is Resolve Studio 21.1 and that
its native MCP is connected to the same local Resolve instance. Discover the
tool names and current API through that MCP; do not guess from another Resolve
version. If 21.1 or the native MCP is unavailable, stop and report the exact
host gate instead of presenting a mock as Resolve evidence.

For the no-provider tracer:

1. Use Resolve native MCP to read the current project, timeline, and selected
   clip. Keep their stable identities and the timeline state for this task;
   recheck them before a Resolve write. If the selected target changes, stop
   instead of retargeting.
2. Submit the fixed local fixture with one unique idempotency key:

   ```bash
   flovart runtime.test.fixture-image --idempotency-key <unique-key> --json
   ```

   From this source checkout, use `npm run flovart:cli --` before the command.
   If submission status is unknown, retry with the same key, never a new one.
3. Poll the returned task ID with `flovart task.get --task-id <taskId> --json`
   until it is completed. Stop on failure or cancellation.
4. Resolve the completed file immediately before import:

   ```bash
   flovart artifact.locate --task-id <taskId> --json
   ```

   The result is a local path plus the verified MIME type, byte size, and
   SHA-256. Use that path only for the immediate host import; do not write it
   into project metadata.
5. Use a bounded Media Pool import operation exposed by the installed Resolve
   native MCP. Import into a root-level bin named `Iris Candidates` (create it
   with `MediaPool.AddSubFolder(root, "Iris Candidates")` if missing, make it
   current with `SetCurrentFolder`, then restore the user's previous folder
   after import). Never rename, move, or delete existing bins. Do not add the fixture to the Timeline, replace a clip, delete
   or overwrite media, or run unrestricted scripts. If the installed MCP has
   no safe bounded import path, stop and report that concrete gap.
6. Re-read the Media Pool and Timeline through Resolve MCP. Confirm the item
   appears in the Media Pool and the Timeline state is unchanged.

`runtime.test.fixture-image` imports the repository's fixed `public/favicon.png`
as a no-provider fixture. It verifies the local task-to-file handoff only; it
does not use the selected clip as a visual reference and is not AI generation.
Never describe it as a generated scene or as a completed real-host tracer until
Resolve visibly accepts the file and the Timeline comparison passes.

## Cold start — no project open

`workflow.inspect` returns `WORKSPACE_UNAVAILABLE` when the browser is
connected but no Workflow project is open. This is not a fatal stop: the task
usually still wants a project. Create and activate one, then inspect again:

```bash
npm run flovart:cli -- workflow.project.create --title "Product Video" --agent-identity codex --idempotency-key <key> --json
npm run flovart:cli -- workflow.project.use --project-id <project-id> --agent-identity codex --idempotency-key <key> --json
npm run flovart:cli -- workflow.inspect --agent-identity codex --json
```

`workflow.project.list` shows existing projects. Only stop for the user when
the browser itself is `offline` — not when the workspace is simply empty.

Every **write** command must carry the same `--agent-identity` used for
`inspect` plus a stable `--idempotency-key`. Passing identity only to `inspect`
and omitting it on `project.create`/`workflow.apply` makes the write fail with
`AGENT_HOST_REQUIRED` — the active Host writer must match the caller identity.

## Intent mapping

- “打开 Flovart” → `ensure`, then `workflow.inspect`.
- “查看当前 Workflow” → `workflow.inspect`.
- “当前选择” → `workflow.selection.get`.
- Add, delete, move, resize, connect, disconnect, or edit → one `workflow.apply`.
- Run a node → `workflow.node.run` after confirming the node from inspection.

For a sequence of nodes, the granular `workflow.node.create-connected` adapter
is the reliable path — it fills the node defaults (including `storageKey`) that
a bare `workflow.apply` `add_node` operation requires. Prefer it over a raw
`add_node` when you only have a type/title/position:

```bash
npm run flovart:cli -- workflow.node.create-connected --from-node-id <id> --type text --title "Shot 2" --x 420 --y 120 --agent-identity codex --idempotency-key <key> --json
```

The UI and Iris own Provider routing, credentials, cost confirmation,
resource resolution, and artifacts. Do not call a Provider directly, store
credentials, modify browser storage, use private routes, or create a second
Workflow runtime. A missing reference or unsupported input must remain an
explicit failure; never downgrade the requested media mode silently.

## Resolve host boundary

For DaVinci Resolve, use Resolve Studio's own native MCP for host context and
project operations; do not create or configure a second Resolve MCP server.
The current `flovart` CLI Workflow operations do not materialize a Runtime
artifact into a durable local file that Resolve can import. Do not infer a file
path from a task/artifact ID, call private Runtime endpoints, or report a Media
Pool import from the task result alone. Until an explicit artifact handoff path
is available and real-host verified, report this boundary clearly.

## Conversation rules

Talk to the user about the Workflow, not the machinery behind it.

- Never echo raw `projectId`, object IDs, `revision`, `mutationId`,
  `idempotencyKey`, or JSON payloads back to the user. Say "the current
  project" or use the node's title instead.
- Never explain internal mechanics — Host writer, lease, bridge, polling,
  session recovery, or the MCP transport. Describe the visible result ("the
  node is running"), not the mechanism.
- Pick reasonable defaults and keep moving: choose a sensible title,
  position, and node type instead of asking. Ask the user only when the
  request is genuinely ambiguous, spends credits, or destroys existing work.
- On failure, run `workflow.inspect` before retrying so the retry uses fresh
  IDs and revision. Attempt at most one automatic recovery for the same
  failure; if it fails again, report the error in user terms and stop.
- On timeout or lost contact, rejoin the same operation with the same
  `idempotencyKey`/`mutationId`. Never resubmit a duplicate mutation under a
  new key.
- Report results in user-facing terms only: what was added or changed on the
  canvas, what is running, what finished. Surface a structured error code
  only when the user must act on it.
