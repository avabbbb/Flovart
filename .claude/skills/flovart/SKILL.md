---
name: flovart
description: Operate Flovart's local Production Runtime, topic-research adapter, visible Workflow Workspace, and Terminal Command Center through canonical CLI or MCP tools. Use when an agent needs to collect recent topic evidence, control visible Workflow nodes, supervise durable provider tasks, or coordinate a Director Skill. Trust command.list over examples and never use legacy shadow/file-bridge, Canvas, or Element commands.
---

# Flovart production control

Use the deterministic local CLI for every Flovart side effect:

```bash
npm run flovart:cli -- <command> --json
```

Published toolkit users may use:

```bash
npx flovart-cli <command> --json
```

## Source of truth

Start every run with the client-side registry:

```bash
npm run flovart:cli -- command.list --json
```

Read each write command before calling it:

```bash
npm run flovart:cli -- command.schema --command <command> --json
```

Only call commands whose registry availability is `available`. If this Skill, a Director Skill, or an old example disagrees with the registry, stop using the stale command.

For visible node work, require `workspace.status`. For generation work, additionally require `runtime.status` and `provider.status`. Registry inspection does not require Desktop Runtime connectivity.

## Authority and adapter boundaries

- Production Runtime owns credentials, Provider routing, idempotent generation tasks, events, cancellation state, and Artifacts.
- Workspace Adapter owns the currently visible browser Workflow project and delegates every graph mutation to the same dispatcher used by manual UI edits.
- Research Adapter collects external topic evidence into idempotent local artifacts. It reports source coverage but does not own ProductionRun state.
- A Director Skill compiles creative intent, beats, style rules, review gates, and capability requirements. It never becomes another execution backend.
- A coding agent plans, inspects, compares, and chooses the smallest revision or retry.

Never send Workspace commands to `shadow-runtime-state.json`, a Vite file queue, browser scraping, CDP, or private globals.

## Connect the visible Workflow

Node commands require:

1. Start Flovart Desktop; Desktop idempotently starts or reuses its Managed Agent.
2. Open the target Workflow.
3. Run `workspace.status`; continue only when `state` is `ready` and `activeProjectId` is the intended project.

If the page, Managed Agent, or project snapshot is unavailable, stop on `WORKSPACE_UNAVAILABLE`. Never fall back to a hidden graph.

## Reliable node workflow

1. Run `workflow.inspect` and use returned project/node/connection IDs.
2. For create operations, provide a stable explicit node ID when the schema allows it.
3. Give every write command a stable `--idempotency-key`.
4. Make the smallest mutation:
   - `workflow.node.create` / `workflow.node.create-connected`
   - `workflow.node.update` for title, prompt, config, or metadata fine-tuning
   - `workflow.node.move` / `workflow.node.resize`
   - `workflow.connect` / `workflow.disconnect`
   - `workflow.select` / `workflow.viewport.set`
5. Re-run `workflow.inspect` and verify the exact visible result.
6. On timeout or disconnect, inspect before retrying. Reuse the same idempotency key only with the identical payload.

Example:

```bash
npm run flovart:cli -- workflow.node.create --id shot-01 --type text --title "镜头 01" --x 120 --y 160 --metadata-json '{"content":"初始镜头说明"}' --idempotency-key "create-shot-01-v1" --json
npm run flovart:cli -- workflow.node.update --node-id shot-01 --patch-json '{"title":"镜头 01：开场","metadata":{"content":"修改后的细节"}}' --idempotency-key "update-shot-01-v2" --json
```

Confirm the current schemas before copying examples.

## Topic research workflow

Use `research.topic.collect` before drafting a trend-led ProductionSpec:

```bash
npm run flovart:cli -- research.topic.collect --topic "US politics" --sources '["reddit","x"]' --subreddits '["politics","worldnews","news"]' --days 30 --idempotency-key "politics-30d-v1" --json
```

1. Inspect the current schema and pass explicit sources, communities, window, and a stable idempotency key.
2. Accept `ready` only when every requested source has evidence. `degraded` means at least one source is missing; `failed` means no requested source produced usable evidence.
3. Treat Reddit RSS position as a rank proxy, never as votes, comments, or cross-platform popularity.
4. X is credential-gated. If it is missing, preserve `coverage.missing: ["x"]`; never invent X posts or silently label web-search snippets as X API evidence.
5. Read the JSON/Markdown artifact paths returned by the command and keep their provenance when converting the selected topic into a ProductionSpec.
6. A Director Skill consumes this artifact. It must not add a private scraper, API key, Provider call, or second research state store.

For a Reddit-only decision, request only `["reddit"]`; do not request X merely to make the report look broader.

## Generation workflow

1. Verify Runtime and Provider readiness.
2. Ask the user to configure missing credentials in Flovart Desktop. Never request or transport a raw key in chat or CLI arguments.
3. Submit the smallest available generation command with typed arguments and a stable idempotency key.
4. Save its `taskId`; observe it with `task.get`, `task.list`, and `event.stream`.
5. Retry only after the existing task reaches a known terminal state.
6. Treat `task.cancel` as local cooperative cancellation unless Provider state explicitly confirms remote cancellation.
7. Distinguish price preview from final bill.

Production Plan Projection is available: a completed `production.dry-run` is persisted as a ProductionRun and StageRun DAG, and the Desktop automatically materializes its latest `workflow.projection.get` result into the matching visible project. Projection refresh preserves user nodes, user connections, viewport, and manual projected-node layout.

Current limitation: generated Runtime Artifacts do not yet attach themselves to the matching projected StageRun node. Never inject private Artifact paths or signed URLs into node metadata.

## Compile a Director ProductionSpec

Run the Director quality gate first, then compile without Provider submission:

```bash
npm run flovart:cli -- production.dry-run --project-id <project-id> --title "VOX Production Plan" --director '{"skillId":"vox-director","version":"1.0.0","contentHash":"sha256:<hash>"}' --file <production-spec.json> --idempotency-key "<stable-plan-key>" --json
```

1. Save the returned `taskId` and wait with `task.get`.
2. Read `productionRunId` from the completed task result.
3. Inspect `production.status --run-id <run-id>` and treat every blocker as real.
4. Read `workflow.projection.get --project-id <project-id>`; the Desktop projection adapter should also place the same plan on the real Workflow.
5. Verify the materialized nodes through `workflow.inspect`.

`production.dry-run` creates no Provider job and spends no credits. A current plan remains `action_required` while Route Plan, Run Budget, or required Runtime Capabilities are missing. Do not reinterpret it as an executable or completed film.

## Director Skill coordination

Treat a Director Skill as a compiler into a versioned ProductionSpec draft. Its output may contain:

- brief and delivery constraints;
- beats, shots, narration, and references;
- style extension data;
- Provider-neutral capability requirements;
- Director review gates and eval expectations.

Reject or migrate packages containing API keys, Provider HTTP calls, hard-coded private routes, arbitrary shell commands, or private polling loops.

For a VOX/collage Director draft, run the deterministic quality gate before any paid keyframe or motion task:

```bash
node tools/flovart/vox-director-quality.js --spec <production-spec.json> --json
```

Do not substitute a generic `paper-cut` prompt for the Director extension. A passing draft must preserve an approved theme, rich torn-paper/halftone/newsprint/tape finish, two-shot beat cadence, per-shot camera and element motion, keyframe review, OCR review, and audio design. Generate and approve collage keyframes before calling image-to-video; direct text-to-video is a tracer path, not a VOX-quality path.

## Terminal Command Center

Run `npm run flovart:cli -- tui`. The Ink TUI observes Runtime, Workflow, durable tasks, and recent events; `/research <topic>` invokes the canonical research command. The TUI is only an interaction surface: it never stores credentials, performs Provider requests directly, or becomes a second production authority.

## Delivery

Report:

- visible project, node, and connection IDs changed;
- the before/after field or layout details verified by `workflow.inspect`;
- task, Provider-attempt, and Artifact IDs that actually exist;
- quote versus confirmed cost;
- pending work and the smallest safe next action;
- whether the result is visible on the Workflow or remains an off-canvas Artifact.
