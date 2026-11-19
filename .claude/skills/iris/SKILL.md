---
name: iris
description: Work in the user's visible Iris Workflow canvas. Use when the user asks to open Iris, look at or change their Workflow, build shots or generation nodes, or run image and video generation.
---

# Iris

Iris is the visible Workflow canvas the user is looking at. You change it
through the local `iris` CLI; the user sees every change live. Iris
prepares its own local session: never ask the user for connection details and
never rebuild a connection flow in the conversation.

The CLI needs Node.js 22.19.0 or newer. In this source checkout, when the
packaged `iris` command is not installed, use the repository entrypoint
instead, for example `npm run iris:cli -- ensure --json`. Do not use `npx iris-cli` as an automatic fallback: an unpublished checkout can make
npx fetch an unrelated package.

## Prepare for this job

Do these in order at the start of every task. Each step has a stop condition;
never skip ahead. Details are in `references/environment.md`.

1. **Understand the request.** Decide what the user wants to see on the canvas
   when you are done, and whether it needs paid generation. Ask only when a
   different reading would change the result.
2. **Make Iris ready.** Run `iris ensure --json`. Continue only when it
   returns `ok: true` and `state: "ready"`; otherwise tell the user the public
   state it returned and stop. `ensure` also opens the user's browser on the
   canvas when needed.
3. **Get on the user's canvas.** Run `iris status --json`, then
   `iris workflow.inspect --agent-identity <host> --json`. Compare the
   project title, node titles and node count with what the user describes or
   shows you. If they disagree, you are reading another canvas: stop and fix
   that first (see "Operate the user's visible canvas").
4. **Check AI services only when generation is needed.** Run
   `iris provider.status --json`. It lists configured services with masked
   keys only. If the route you need is missing, tell the user where to add it
   in Iris Settings (`references/providers.md`). Never ask for a key in the
   conversation, and never read, write or move one yourself.
5. **Quote and agree.** Before any paid run, tell the user how many runs, which
   model, and what each run is for, and wait for their go-ahead.
6. **Work and narrate.** Make the change, inspect again, and tell the user what
   is now on their canvas in their terms.

## The stable surface

Use `ensure` to prepare, then these five operations for all normal work:
`status`, `workflow.inspect`, `workflow.selection.get`, `workflow.apply`, and
`workflow.node.run`. To hand one turn to the user's built-in Iris Agent,
delegate with `agent.turn`.

```bash
iris ensure --json
iris status --json
iris workflow.inspect --agent-identity codex --json
iris workflow.selection.get --agent-identity codex --json
iris agent.turn --prompt "给镜头 1 写一版提示词" --policy read-only --mutationId turn-1 --json
```

- `agent.turn` runs exactly one turn of the built-in Agent and returns a
  summary (text, tool names, `draftVersion`), not a transcript. It is read-only
  unless you pass `--policy workspace-write`, which asks the user first. Pass a
  stable `mutationId`: the same id replays the same result instead of running
  twice, and a busy Agent returns `AGENT_BUSY`.
- Anything that may take longer than a minute (`agent.turn`, a paid
  `workflow.node.run` / `workflow.group.run` / `workflow.generate`, `workflow.image.tool` / `workflow.video.tool` / `workflow.audio.tool`,
  `workflow.media.import`, `workflow.export`) can run as a background task:
  `agent.task.start --command <command> --args '<json>' --idempotency-key <key>`
  returns a `taskId` at once; poll `agent.task.get --task-id <id> --after-seq
  <last seq>` every 5–10 s until `done` is true, then read `result` or
  `error`. `agent.task.cancel --task-id <id>` stops it and asks the canvas to
  stop nodes it started (for a group run: every member of the group) (already-submitted provider jobs may still be billed).
  Confirmations, budget and pre-checks of the wrapped command still apply.
  Tasks are kept in a local ledger (`~/.iris/agent-tasks.json` for the local
  Agent, IndexedDB for the built-in web Agent, which has the same three tools
  `iris_task_start/get/cancel` for the browser commands), so `get` and
  `cancel` still work after a restart or page reload; finished tasks are kept
  7 days. A task that was in flight during the restart is reconciled against
  its canvas nodes; if it may already have been submitted (and billed) its
  status is `unknown_submit`: do not rerun it. Starting the same command with
  the same args again returns that task (`resubmitRequiresConfirmation`)
  instead of submitting twice; ask the user, cancel it, then start again.
- CLI output is pipe-friendly: each `--json` result is one line on stdout
  (NDJSON; add `--pretty` to indent it), progress goes to stderr prefixed
  `[iris]`. A downstream command reads node ids from stdin with
  `--references -` (`workflow.generate`) or `--node-ids -`
  (`workflow.node.run`, `workflow.focus.nodes`, `workflow.export`).
  `agent.task.start ... --wait` streams task events to stderr and prints only
  the final result. `status` also reports `diagnostics`: the bound project and
  writer, where the Agent credential came from (token masked), state-file
  modification times, and `workspaceUnavailableReason` — read it first when a
  command fails with `WORKSPACE_UNAVAILABLE`.

- `--agent-identity` names your host (`codex`, `claude-code`, `opencode`,
  `workbuddy`). Pass the same value on `workflow.inspect` and on every write
  or run; a write without it, or with a different one, fails with
  `AGENT_HOST_REQUIRED`.
- Before a change, read the real `projectId`, object IDs and revision from
  `workflow.inspect`. Read `workflow.selection.get` when the request depends on
  what the user selected.
- Group related graph edits into one `workflow.apply`, with the project and
  revision you read as preconditions and a stable `mutationId` and
  `idempotencyKey`. Every write or run carries its own idempotency key.
- After a write, inspect again. On failure, keep the structured error code,
  inspect before retrying, and stop when the canvas is unavailable or the
  target or revision changed. Never switch to another project and never
  retry a mutation under a new identity.

Other hosts (an optional local MCP projection, DaVinci Resolve) are described
in `references/hosts.md`. Read it only when the task names such a host.

## Operate the user's visible canvas

The canvas the user is looking at is the only canvas that counts. Each rule
below comes from a real session where an agent wrote to a canvas the user
could not see, or said it could see their canvas when it could not.

1. Never drive your own browser tab. Do not open the WebUI in a headless or
   agent-managed browser (Playwright, an eval browser, a hidden tab). Every
   browser keeps its own local Workflow store: a project created there never
   appears on the user's screen, and while that tab stays connected
   `workflow.inspect` may read it instead of the user's canvas. If you opened
   one, close it before you continue.
2. Open the user's browser only through `iris ensure` or `web.open`.
   They hand the complete one-time link to the default browser. Never hand-roll an opener: on Windows
   `rundll32 url.dll` drops everything after `&`, and `cmd /c start` treats `&`
   as a command separator. The page then loads unconnected (its footer shows
   本地优先) and the user keeps seeing an old canvas. The link expires after 60
   seconds; if the page did not connect, open a fresh one instead of reusing an
   old tab.
3. Prove you are on the user's canvas before the first write (step 3 above).
   `iris status --json` must show the user's tab and no leftover agent tab.
   Never tell the user you can see their canvas until this check passes.
4. Do not create a project while the user has one open. A new project is only
   for an empty, connected workspace. Demo or test nodes go into the user's
   current project with a clear title and never trigger a paid run.
5. When the user says they cannot see your change, assume you are on the wrong
   canvas, not that their screen is stale. Redo step 3 before anything else.

### Layout: left to right in flow order

Place nodes in the order data flows: upstream on the left, downstream on the
right, every connection from the left node's output to the right node's input.

- `workflow.node.create-connected --from-node-id A` makes the new node
  downstream of A. Put it to the right: x = A.x + A.width + 80, same y as A.
- A node that feeds A (a script, a reference) is connected into A with
  `workflow.connect --from-node-id <source> --to-node-id A` and placed to the
  left: x = A.x - 80 - source.width.
- Never put a downstream node left of, or directly below, its source. A
  backward connection is drawn as an S-curve hidden behind the opaque cards,
  so the user only sees stray stubs at the ports; a node directly below gets a
  diagonal line that ends in a loop.
- Fix a wrong layout with `workflow.disconnect --connection-id <id>`,
  `workflow.connect` and `workflow.node.move --node-id <id> --x <x> --y <y>`,
  each with its own idempotency key, then inspect again. Read node widths from
  `workflow.inspect`; never assume them.

### Empty workspace

`workflow.inspect` returns `WORKSPACE_UNAVAILABLE` when the browser is
connected but no project is open. That is not a stop: create and activate a
project, then inspect again.

```bash
npm run iris:cli -- workflow.project.create --title "Product Video" --agent-identity codex --idempotency-key <key> --json
npm run iris:cli -- workflow.project.use --project-id <project-id> --agent-identity codex --idempotency-key <key> --json
npm run iris:cli -- workflow.inspect --agent-identity codex --json
```

`workflow.project.list` shows existing projects. Stop for the user only when
the browser itself is offline.

## Building and running

- “打开 Iris” → `ensure`, then `workflow.inspect`.
- “看看当前 Workflow” → `workflow.inspect`. “当前选择” → `workflow.selection.get`.
- Generate an image or video → one `workflow.generate` (MCP / Agent tool
  `iris_generate`). It creates or reuses **one** generation node, writes the
  prompt into that node's Prompt Bar, turns `references` into Prompt Bar @chips
  plus connections (order = chip order), picks the mode from the references
  and, with `run: true`, runs it in place:

  ```bash
  npm run iris:cli -- workflow.generate --type video --title "Shot 2" --prompt "@ref:<shot-1-image> 里的人物转身走进雨里" --references '[{"nodeId":"<shot-1-image>","role":"first_frame"}]' --shot '{"index":2,"durationSec":5}' --agent-identity codex --idempotency-key <key> --json
  ```

  `nodeId`, each `references[].nodeId` and `@…` in the prompt also accept an
  approved anchor's code (characters `A01`, scenes `S01`, products/props `P01`,
  styles `T01` — shown before the node title, listed by `workflow.inspect`),
  `shot:N`, or a node title. A title shared by several nodes returns
  `AMBIGUOUS_NODE_NAME` with candidates; retry with the id or code. Example:
  `--node-id shot:3 --prompt "@A02 站在 @S02 的雨里" --references '["A02","S02"]'`.
  To use only part of an image (focus edit / a face / a product detail), give
  that reference a `region` `{x,y,w,h}` in 0-1 of the original image, e.g.
  `--references '[{"nodeId":"A01","region":{"x":0.3,"y":0.05,"w":0.4,"h":0.4}}]'`.
  The chip shows the cropped area and the provider receives the crop; no crop
  node is created. Images only.

  Never build a text node (or a "prompt/config node") and connect it to a
  generation node: text nodes are notes for people and are never generation
  input. Shot order is `shot.index`, not a chain of connections.
- In `workflow.generate` prompts, refer to inputs as `@ref:<nodeId>` or
  `@"Node name"`; anything mentioned gets connected (`autoLinked`), and
  disconnecting a source removes its chip (`prunedMentions`).
- Several shots: build them all with `workflow.generate` (no `run`), then
  run the list once with `workflow.node.run --node-ids` (one approval card,
  each node runs once).
- Runs block until a terminal status (`succeeded` / `failed` / `timeout` /
  `unknown_after_submit`); never poll `workflow.inspect` while a run is in
  progress, and never retry `unknown_after_submit`.
- Pick or change a model → `workflow.models.list` first (live catalog with
  per-mode configuration and reference min/max). On `MODE_UNSUPPORTED`,
  `REFERENCE_COUNT_OUT_OF_RANGE` or `REFERENCE_LIMIT`, switch to one of the
  returned `details.candidates` (`{modelId, mode}`) or fix the reference count
  as the message says; do not try models one by one.
- Multi-angle 3×3 grid, character turnaround, 2×2 / 5×5 storyboard grid,
  relight or portrait enhance → `workflow.shortcut.apply --scene <id>`
  (Agent tool `iris_shortcut_apply`; ids from `workflow.shortcut.list`).
  Always one node and `count=1`: grid tools render one grid image in place
  (or in one new node to the right of a bare image), non-grid tools create one
  node to the right. Split a grid later with `image.split-grid@1`; never build
  N nodes for a grid.
- Group nodes → `workflow.group.create --node-ids a,b,c` (a group frame:
  `subgraph` with `metadata.groupKind: "group"`, members carry `parentId`;
  unrelated to generation batches and alternates). Run the whole group in
  dependency order with one confirmation → `workflow.group.run --group-id <id>`
  (`--dry-run` returns the order only).
- Bring an image from a URL or the asset library onto the canvas →
  `workflow.media.import` (optionally `attachToNodeId` to use it as a reference).
- Storyboard rows of a script node → `workflow.script.materialize --script-node-id
  <id> --kind image|video --rows 1-5`. One generation node per row: the row's
  `imagePrompt` / `videoPrompt` goes into that node's Prompt Bar, the row's
  `characterRefs` (and any `@ref:<id>` in the prompt) become @chips +
  connections, the node carries `shot` metadata, and the script row keeps only
  `imageNodeId` / `videoNodeId`. It creates and never runs; rows already
  materialized are skipped. Run the returned `nodeIds` with one
  `workflow.node.run` (batch by rows, e.g. 1-5 then 6-9).
- Export or download results → `workflow.export` with `nodeIds` or `groupId`
  (a group is the nodes' `batchId`). One media node exports its original file;
  several nodes or a group export a ZIP named by node title; script nodes
  export a shot-list CSV. It never changes the canvas. Pass `inline: true`
  only when you need the bytes back (≤20MB, base64).
- Write a note only when the user asks for one → `workflow.note.write`. Notes
  never connect to anything.
- Move, connect, disconnect, group, retitle or reorder references → one
  `workflow.apply` (`reorder_connections` with `targetNodeId` +
  `orderedSourceIds`).
- Run a node → `workflow.node.run` after confirming the node from inspection.
  Several independent nodes → one `workflow.node.run` with `nodeIds`; the user
  agrees to the cost once and the result lists each node. Rerun only failed
  nodes. Seedance runs are pre-checked locally (image references: jpeg/png/
  webp/bmp/tiff/gif, each side 300–6000px, aspect 0.4–2.5, <30MB); one failure
  rejects the whole batch with `SEEDANCE_PREFLIGHT_FAILED` and lists the nodes.
  Fix those references, then rerun the batch.

### Generation runs on the canvas

- Build each shot as a generation node on the canvas: prompt, model,
  parameters, and reference nodes connected to its inputs. Run it with
  `workflow.node.run`.
- Never call a Provider API from a local script and paste the result onto the
  canvas as a static image. That node has no prompt, model or references, so
  the user cannot adjust and rerun it; it is not a Iris result.
- Iris owns Provider routing, credentials, cost confirmation and artifacts.
  Do not store credentials, edit browser storage, use private routes, or start
  a second Workflow runtime.
- If `workflow.node.run` returns `RUNNER_UNAVAILABLE`, or no node type can
  express the request, stop and report it. A missing reference or unsupported
  input stays an explicit failure; never quietly downgrade the media mode.

## Talking to the user

Talk about the canvas, not the machinery behind it.

- Never echo `projectId`, object IDs, revisions, mutation or idempotency keys,
  or JSON back to the user. Say "the current project" or use node titles.
- Never explain internal mechanics (host writer, lease, bridge, polling,
  session recovery, transports). Describe what is visible: "the node is
  running".
- Pick sensible defaults for titles, positions and node types and keep moving.
  Ask only when the request is genuinely ambiguous, spends credits, or
  destroys existing work.
- On failure, inspect before retrying. Make at most one automatic recovery for
  the same failure; if it fails again, explain it in user terms and stop.
- On timeout or lost contact, rejoin the same operation with the same
  idempotency key. Never resubmit under a new key.
- Report what was added or changed, what is running, and what finished.
  Mention a structured error code only when the user must act on it.

### Ask everything up front (before spending credits)

Before a video, storyboard or multi-shot job, collect in **one** ask (built-in
Agent: `iris_ask` with `questions`; other hosts: your host's ask tool)
every item below that the request or canvas does not already answer. Skip what
is already known; never ask the same thing twice in a task.

| id | Ask about | Typical options |
| --- | --- | --- |
| `duration` | Total length | 5s / 10s / 15s / 30s |
| `aspect_ratio` | Frame | 9:16 vertical / 16:9 horizontal / 1:1 |
| `resolution` | Resolution / tier | 480p draft first, then upgrade / 720p / 1080p |
| `subtitles` | Subtitle language | none / Chinese / English / bilingual |
| `characters` | Character references | use @-referenced images / generate anchors first / none |
| `segments` | How many segments | 1 / 3 × 5s / per-shot |
| `outline` | Where the outline comes from | user's script / Agent drafts it for approval / from reference video |

- Write options as **complete plans** the user can accept in one click
  (for example “15s vertical 9:16, 3 segments × 5s, 480p draft first”), mark
  the recommended one, and let the “Other” box take anything else.
- One ask, up to 12 questions; then work without further check-ins until a
  cost confirmation or a real blocker.

## Ending a task: the outcome claim

When a task is finished, stopped or refused, make the very last line of your
final message one JSON object and nothing else, for example:

    {"irisClaim":{"status":"succeeded"}}
    {"irisClaim":{"status":"failed","code":"REVISION_MISMATCH"}}
    {"irisClaim":{"status":"unsupported","code":"UNKNOWN_COMMAND"}}

- succeeded: every requested change or run is visible in the Workflow after a
  fresh `workflow.inspect`. Never claim success from a command reply alone.
- failed: the capability exists but this attempt did not complete; `code` is
  the structured error code the failing command returned.
- unsupported: the product refused the capability itself. Change nothing to
  work around it, and give the refusal code exactly as returned.

Give a code for failed and unsupported, never an invented one. The claim is
checked against the real final Workflow, and a claim never turns a failure
into a pass. This line is a machine-readable ending, not part of what you tell
the user.

## References

- `references/environment.md`: the four readiness layers and what to do when
  each one is missing.
- `references/providers.md`: AI service routes, what the user provides, where
  they add it, and how to verify it.
- `references/hosts.md`: the optional MCP projection and the DaVinci Resolve
  tracer.
- `commands/pipeline.md`: the Agent video pipeline (runs, capture, voice,
  render, review). Read it only when the task is to make or revise a video.
- `commands/skill.md`: Production Skills (list, install from a Skill Hub,
  turn a canvas into a Skill). Read it only when the task is about Skills.
- `commands/`: compatibility and diagnostic commands. Not needed for normal
  work.
