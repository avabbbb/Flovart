---
name: flovart
description: Use Iris's Workflow and guide a Resolve native-MCP handoff through the compatible flovart CLI when current interfaces support it.
---

# Iris

Iris's visible Browser Workflow is the current Workflow authority. The Link layer prepares the local
session automatically. Do not ask the user for connection details and do not
recreate a connection flow in the conversation.

This Skill expects Node.js 22.19.0 or newer when the local CLI is run.

## Normal Browser Workflow loop

Start every new Browser Workflow task with:

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

The same five operations are available through Iris's optional local stdio MCP
projection for MCP-capable hosts such as TeleAgent. This is separate from any
creative host's native MCP. The Iris MCP names are
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

## DaVinci Resolve native MCP handoff

Resolve Studio's native MCP is the host control plane. Discover its available
tools and current scripting documentation from the installed Resolve/Agent
integration each session; tool names and exposed operations are not an Iris
contract. Use that native integration for read-only project, timeline, and
selection inspection first. Do not create or install an Iris Resolve MCP
server, guess tool names, or run an unbounded script when the available
operation cannot be established.

Before generation, record the project and selected item's identity from the
actual Resolve response, along with any timeline, track, range, timecode, and
media identity fields that Resolve exposes. Do not invent unavailable fields.
Freeze that target for the task. If selection changes while work is running,
keep the original target and report the change; never retarget to the new
selection. Keep Agent reasoning in its existing host. Show the target, intent,
and any paid route/cost for human review, and obtain the required generation
approval before submitting.

The current Runtime CLI has durable-generation commands, but inspect the live
registry/schema before using them:

```bash
flovart command.list --json
flovart command.schema --command generate.image --json
flovart command.schema --command generate.video --json
flovart command.schema --command task.get --json
```

Use only the arguments exposed by those schemas. A submitted Runtime task's
`taskId` is its durable identity: query that same task with `task.get` and
preserve the returned task/artifact provenance, checksum, and size. Runtime
write commands require a stable `--idempotency-key`; if submission status is
unknown, never create a new key or blindly submit a duplicate. If the original
task cannot be identified or replayed safely, stop. The current media result
uses `taskId` as its durable handle and does not separately return an
`artifactId`. Do not call a Provider directly or place credentials in Resolve,
the Skill, logs, or artifact metadata.

**Current Resolve handoff limitation:** the canonical CLI can submit/query
Runtime generation and the task result records a relative `storeRelpath`,
checksum, and byte size. The CLI does not currently expose a supported command
that resolves that private Runtime path to a durable local file or reads the
artifact bytes for Resolve. The `workflow.node.run` artifact lookup is backed
by a process-local registry with a 30-minute TTL and is not a durable Resolve
handoff. Also, the direct Runtime generation schemas accept source image/video
task IDs that already exist in Iris Runtime; they do not accept the Resolve
selection itself as a source. Therefore, if the selected Resolve media is not
represented by a supported Iris reference, stop before paid submission. If a
completed artifact cannot be materialized through a supported Iris interface
as a stable local file, stop before Media Pool import. Do not guess an
app-data path, call private Runtime endpoints, treat `storeRelpath` as an
absolute path, or claim the artifact was imported.

When both a source reference and a stable local artifact are available through
supported Iris interfaces, let the user review the candidate and explicitly
approve **Add to Media Pool**. Use only the installed native MCP operation
whose current documentation confirms that bounded import behavior, then
re-read the Media Pool to verify the new item and confirm the original
timeline was unchanged. Do not automatically import, replace, overwrite, or
delete the source.

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

- “打开 Iris” → `ensure`, then `workflow.inspect`.
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

The Iris UI and Core own Provider routing, credentials, cost confirmation,
resource resolution, and artifacts. Do not call a Provider directly, store
credentials, modify browser storage, use private routes, or create a second
Workflow runtime. A missing reference or unsupported input must remain an
explicit failure; never downgrade the requested media mode silently.

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
