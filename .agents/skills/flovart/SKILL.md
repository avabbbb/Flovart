---
name: flovart
description: Operate Flovart's local Production Runtime as the production control tower for provider readiness, durable generation tasks, progress events, cancellation, and artifact delivery. Use when an agent needs to run or supervise Flovart media production, coordinate a Director Skill, or determine whether a requested Workflow/canvas action is actually available. Trust command.list over examples; never use legacy-only Workflow, Canvas, Element, or file-bridge commands.
---

# Flovart production control

Use the deterministic local CLI for every Flovart side effect:

```bash
npx flovart-cli <command> --json
```

Source contributors may use:

```bash
npm run flovart:cli -- <command> --json
```

## Source of truth

Start every run with:

```bash
npx flovart-cli runtime.status --json
npx flovart-cli command.list --json
npx flovart-cli provider.status --json
```

Read each write command before calling it:

```bash
npx flovart-cli command.schema --command <command> --json
```

Only call commands whose registry availability is `available`. If this Skill, an installed Director Skill, or an old example disagrees with the registry, stop using the stale command.

## Role split

- Let the Director Skill compile creative intent, beats, style rules, review gates, and capability requirements.
- Let the coding agent plan, compare, request reviews, and decide the smallest retry or revision.
- Let Flovart own credentials, idempotent side effects, Provider routing, durable tasks, events, cancellation state, and Artifacts.
- Never let a Director Skill read a secret, choose a private Provider endpoint, call arbitrary HTTP, or claim a generated result without a Flovart task or Artifact.

## Current production flow

1. Inspect `command.list` and the required schemas.
2. Verify Runtime and Provider readiness.
3. Ask the user to configure missing credentials in Flovart Desktop settings. Never request or transport a raw key in chat or CLI arguments.
4. Submit the smallest available generation command with explicit typed arguments and a stable idempotency key.
5. Save its `taskId`; observe it with `task.get`, `task.list`, and `event.stream`.
6. Retry only after the existing task reaches a known terminal state. Reuse an idempotency key only for the identical payload.
7. Treat `task.cancel` as a local cooperative cancellation request unless the returned Provider state explicitly confirms remote cancellation.
8. Report task, Provider-task, Artifact, quote, and verification identifiers. Distinguish a price preview from the final bill.

Example:

```bash
npx flovart-cli generate.video \
  --provider runningHub \
  --prompt "<explicit shot prompt>" \
  --duration-sec 8 \
  --aspect-ratio 16:9 \
  --resolution 720p \
  --idempotency-key "<stable-shot-key>" \
  --json

npx flovart-cli task.get --task-id "<task-id>" --json
npx flovart-cli event.stream --task-id "<task-id>" --after-event-id 0 --json
```

Confirm the current schema before copying the example.

## Workflow and canvas truth

- A Provider task or Artifact is not automatically a visible Workflow node.
- Do not claim canvas synchronization unless `workflow.*` commands are `available` and the returned result contains the authoritative project/spec/projection revision.
- Do not use `shadow-runtime-state.json`, the development file queue, browser scraping, CDP, or private globals as canvas state.
- When Workflow commands are unavailable, run only the registered production task and state clearly that the result is off-canvas.
- Once projection commands become available, use semantic edits through a ProductionSpec revision and layout-only edits through a layout revision. Never maintain an independent Agent graph beside the visible canvas.

## Director Skill coordination

Treat a Director Skill as a compiler into a versioned ProductionSpec draft, not as another execution backend. Its output should contain:

- brief and delivery constraints;
- beats, shots, narration, and references;
- style extension data;
- Provider-neutral capability requirements;
- Director review gates and eval expectations.

Reject or migrate any Director package that embeds API keys, Provider HTTP calls, hard-coded private routes, arbitrary shell commands, or its own job polling loop.

## MCP

Install the MCP wrapper with:

```bash
npx flovart-cli init --host codex
```

The public MCP exposes only the same `available` Production Runtime commands. It must not resurrect legacy Workflow commands or add a second state backend.

## Delivery

Report:

- the creative plan or revision used;
- task, run, stage, Provider-attempt, and Artifact IDs that actually exist;
- quote versus confirmed cost;
- failed or pending work and the smallest safe next action;
- whether results are visible on the canvas or currently off-canvas;
- any user review, provider setup, or billing check still required.
