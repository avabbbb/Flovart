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
npm run flovart:cli -- workflow.node.create --type image --title "主视觉" --metadata '{"prompt":"雨夜霓虹街头的产品特写","config":{"mode":"image","modelId":"flovart:seedream-5-flash","aspectRatio":"16:9"}}' --json
npm run flovart:cli -- workflow.node.create-connected --from-node-id <image-id> --type video --title "图生视频" --metadata '{"prompt":"镜头缓慢推进","config":{"mode":"video","modelId":"<video-product-model-id>","durationSec":5,"resolution":"480p"}}' --json
npm run flovart:cli -- workflow.node.run --node-id <image-id> --idempotency-key shot-1-v1 --json
npm run flovart:cli -- workflow.node.run --node-ids <shot-1>,<shot-2>,<shot-3> --idempotency-key batch-1-v1 --json
npm run flovart:cli -- workflow.focus.nodes --node-ids <shot-1>,<shot-2> --json
npm run flovart:cli -- workflow.node.stop --node-id <image-id> --json
```

The stable Agent surface is `workflow.inspect`, `workflow.selection.get`, `workflow.apply`, and `workflow.node.run` (with `workflow.node.stop` for cancellation). Granular `workflow.node.*`, connection, selection, and viewport commands remain compatibility adapters and route through the same visible Workflow contract.

## Node types and generation settings

`workflow.node.create` / `workflow.node.create-connected` accept `--type` `image`, `text`, `video`, or `audio` (default `text`); any other type is rejected. There is no `config` node type: a generating node is an `image` or `video` node whose `metadata.config` carries the settings. Pass them with `--metadata '<json>'`:

- `metadata.prompt` — the prompt used for generation.
- `metadata.config.mode` — `image` or `video`.
- `metadata.config.modelId` — required for image and video runs; a platform product model ID (for example `flovart:seedream-5-flash`). A run without it fails with “请先在 PromptBar 明确选择…产品模型”. Copy an ID from an existing node (`workflow.inspect`) or the PromptBar model picker instead of guessing.
- Optional `metadata.config` fields: `aspectRatio`, `resolution`, `quality`, `count` (1–4), `durationSec` (video), `generateAudio` (video).

When an `image` node runs it is converted in place into an `image.generate` Operation with the same node ID; read results from `workflow.inspect` afterwards.

Text nodes are not used as generation inputs. A connected `text` node is never merged into the prompt of a downstream image or video node, and text connections into an image node are dropped when it is converted to an Operation. Put the prompt on the generating node itself (`metadata.prompt`). Only media nodes (images, plus video/audio for video models) connected upstream become references.

## Running nodes

To run several independent nodes at once, pass `nodeIds` instead of `nodeId`; the two are mutually exclusive. `--node-ids` accepts a comma-separated list (`a,b,c`), a JSON array string (`'["a","b"]'`), or an array from MCP; `workflow.focus.nodes` parses `--node-ids` the same way. The batch needs one confirmation, runs every node in parallel through the same executor, checks `expectedRevision` once at the start, and returns `{ projectId, runs: [{ nodeId, ok, runId?, artifact?, error? }], failed }`. It errors only when every node fails; rerun only the failed nodes.

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
