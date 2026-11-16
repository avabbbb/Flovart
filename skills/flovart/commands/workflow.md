# Workflow commands

Workflow is the current automated generation workspace. Table has no registered CLI commands yet.

Normal Agent flow starts from readiness and inspect:

```bash
npm run flovart:cli -- ensure --json
npm run flovart:cli -- workflow.inspect --json
```

Use `command.list` / `command.schema` only when a compatibility command is unfamiliar or the Registry contract has changed.

Typical graph operations:

```bash
npm run flovart:cli -- workflow.project.list --json
npm run flovart:cli -- workflow.project.create --title "产品视频" --json
npm run flovart:cli -- workflow.project.use --project-id <project-id> --json
npm run flovart:cli -- workflow.inspect --json
npm run flovart:cli -- workflow.selection.get --json
npm run flovart:cli -- workflow.models.list --mode image --json
npm run flovart:cli -- workflow.generate --type image --title "主视觉" --prompt "雨夜霓虹街头的产品特写" --aspect-ratio 16:9 --idempotency-key key-1 --json
npm run flovart:cli -- workflow.generate --type video --title "图生视频" --prompt "@ref:<image-id> 镜头缓慢推进" --references '[{"nodeId":"<image-id>","role":"first_frame"}]' --duration-sec 5 --run --idempotency-key shot-1-v1 --json
npm run flovart:cli -- workflow.media.import --url https://example.com/ref.png --attach-to-node-id <video-id> --idempotency-key import-1 --json
npm run flovart:cli -- workflow.node.run --node-id <image-id> --idempotency-key shot-1-v2 --json
npm run flovart:cli -- workflow.node.run --node-ids <shot-1>,<shot-2>,<shot-3> --idempotency-key batch-1-v1 --json
npm run flovart:cli -- workflow.focus.nodes --node-ids <shot-1>,<shot-2> --json
npm run flovart:cli -- workflow.node.stop --node-id <image-id> --json
npm run flovart:cli -- workflow.script.materialize --script-node-id <script-id> --kind image --rows 1-5 --idempotency-key shots-1 --json
```

The stable Agent surface is `workflow.inspect`, `workflow.selection.get`, `workflow.focus.nodes`, `workflow.apply`, `workflow.generate`, `workflow.models.list`, `workflow.media.import`, `workflow.script.materialize`, `workflow.note.write`, `workflow.node.run`, `workflow.node.stop` and `workflow.node.tool`. Tool names, descriptions and full parameter schemas are the same in the built-in Agent, the local Agent, MCP and DSH (`tools/flovart/agent-tools.js`). Granular `workflow.node.*`, connection, selection, and viewport commands remain compatibility adapters and route through the same visible Workflow contract.

## Generating: one node, prompt in its Prompt Bar

`workflow.generate` is the generation entry point:

- `nodeId` reuses an image/video generation node; without it, `type` (`image` | `video`) creates one. Text notes, script and audio nodes are rejected.
- `prompt` is written into the node's Prompt Bar (`metadata.prompt` + `metadata.richTextDocument`). `@ref:<nodeId>`, `@图片1` / `@视频1` and unique upstream titles become @chips; references the text does not mention are appended as chips so they still take part.
- `references: [{ nodeId, role? }]` are connected in order (chip order = connection order, first/last frame use the first two). Roles: `first_frame`, `last_frame`, `reference`, `character`, `style`, `mask`, `source_video`, `source_audio`.
- The mode is inferred from references (`text-to-image` / `image-to-image`; `text-to-video` / `image-to-video` / `first-last-frame` / `reference-to-video`) unless `submode` is given. Without `modelId` the Prompt Bar's default policy picks the model. Incompatible model, mode, reference count or parameter returns `MODEL_NOT_FOUND`, `MODE_UNSUPPORTED`, `REFERENCE_LIMIT` or `PARAM_UNSUPPORTED` with `details.compatibleModels`; nothing is silently downgraded.
- `run` defaults to `false` (no cost). `run: true` runs in place after confirmation and returns `run: { runId, batch: { batchId?, headNodeId, memberNodeIds }, takes: [{ nodeId, artifactId, kind }] }`. `dryRun: true` returns the resolved node, model and references without writing.
- Updating only `metadata.prompt` with `workflow.apply` keeps the node's existing @chips (re-linked by label, missing ones appended); use `workflow.generate` to rewrite a prompt with different references.

`workflow.models.list` returns `{ models: [{ id, name, capability, source: static|runninghub-doc, available, isDefault, modes: [{ mode, configured, maxReferences }], counts, aspectRatios, resolutions, durations }], defaultModelIds }` from the browser's live catalog under the user's API keys.

## Node types and generation settings

`workflow.node.create` / `workflow.node.create-connected` require `--type` `image`, `video`, or `audio`; any other type is rejected, and Agent / CLI / MCP sources get `NOTE_IS_ANNOTATION` for `text` (notes go through `workflow.note.write`, prompts into the generation node). There is no `config` node type: a generating node is an `image` or `video` node whose `metadata.config` carries the settings. Prefer `workflow.generate`; the compatibility path passes them with `--metadata '<json>'`:

- `metadata.prompt` — the prompt used for generation.
- `metadata.config.mode` — `image` or `video`.
- `metadata.config.modelId` — required for image and video runs; a product model ID from `workflow.models.list`. A run without it fails with “请先在 PromptBar 明确选择…产品模型”.
- Optional `metadata.config` fields: `aspectRatio`, `resolution`, `quality`, `count` (1–4), `durationSec` (video), `generateAudio` (video).

When an `image` node runs it is converted in place into an `image.generate` Operation with the same node ID; read results from `workflow.inspect` afterwards.

Text nodes are not used as generation inputs. A connected `text` node is never merged into the prompt of a downstream image or video node, and text connections into an image node are dropped when it is converted to an Operation. Put the prompt on the generating node itself (`metadata.prompt`). Only media nodes (images, plus video/audio for video models) connected upstream become references.

## Running nodes

To run several independent nodes at once, pass `nodeIds` instead of `nodeId`; the two are mutually exclusive. `--node-ids` accepts a comma-separated list (`a,b,c`), a JSON array string (`'["a","b"]'`), or an array from MCP; `workflow.focus.nodes` parses `--node-ids` the same way. The batch needs one confirmation, runs every node in parallel through the same executor, checks `expectedRevision` once at the start, and returns `{ projectId, runs: [{ nodeId, ok, runId?, status?, batch?, takes?, artifact?, error? }], failed }`. A single run returns `{ projectId, nodeId, runId, status, batch: { batchId?, headNodeId, memberNodeIds }, primaryNodeId, takes: [{ nodeId, artifactId, kind, mimeType }], artifact }` — with `count > 1` every take of the batch is listed, not just the cover. It errors only when every node fails; rerun only the failed nodes.

### Idempotency key

Always pass `--idempotency-key <key>` on `workflow.node.run` (paid). A repeated call with the same key from the same source — an Agent retry, a timeout retry, a double submit — returns the same `runId` and result instead of starting another paid generation; concurrent duplicates share the one in-flight run. Use a new key only when you deliberately want a new take. If the CLI omits the key for a long-running command, it generates one per call and reports it in the timeout error details so a retry can reuse it. The replay cache lives in the open browser workspace and is cleared when the page reloads.

### Waiting, timeouts and retries

`workflow.node.run` waits for the generation to finish and returns only then; video runs commonly take several minutes. The CLI waits up to 16 minutes and the Agent session up to 15 minutes for long-running commands. RunningHub tasks are polled every 5 seconds for up to 10 minutes, after which Flovart asks RunningHub to cancel the task and reports a timeout.

Flovart does not automatically retry a failed run or switch provider routes. If the CLI times out (`WORKSPACE_TIMEOUT`), the task may still be running: run `workflow.inspect` and check the node status before doing anything, and retry with the same idempotency key. Never retry `SEEDANCE_SUBMISSION_UNKNOWN`; the upstream task may already be created and billed. After a page reload, a video node that already has a provider task ID resumes polling the same upstream task instead of submitting again.

After a successful run the Agent writes one `artifact` receipt per `runId` (read them with `receipts.list --project-id <id>`), and RunningHub runs record the actual cost reported by RunningHub.

Read returned IDs directly, then use `workflow.inspect` to verify the redacted graph. Never use removed `canvas.*` or `element.*` commands.

## Session browser for external agent trials

External agents (Codex CLI and similar) operate the visible Workflow through the CLI while a persistent headless browser holds the workspace writer role. Start it once per trial environment:

```bash
npm run session:browser
```

The script prints one JSON readiness line (`{"ok":true,"role":"session-browser",...}`) and stays alive until killed. Harnesses can verify the writer without launching a browser:

```bash
node scripts/codex-session-browser.mjs --check
```

`--check` prints `{ok, clients, activeWriter, activeHostWriter}` from the Agent `/health` endpoint and exits 0 only when the agent reports healthy. The connect path retries the initial browser bootstrap up to 3 times (5s backoff) before failing.
