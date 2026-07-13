# Status and Diagnostics Commands

Use these before changing a canvas or running generation.

## status

Inspect runtime, provider, media, workflow, and state-file summary.

```bash
npm run flovart:cli -- status --json
```

Read:

- `runtime`: usually `file-state` for local shadow runtime.
- `data.provider`: shadow metadata only; use `provider.status` for the browser UI's authoritative provider readiness and selected models.
- `data.mediaElements`: current image/video count.
- `data.workflow.nodes`, `data.workflow.edges`, `data.workflow.runs`: workflow shape.
- `data.stateFile`: local shadow runtime file path.

## doctor

Diagnose CLI bridge setup without exposing secrets.

```bash
npm run flovart:cli -- doctor --json
```

Use when:

- The browser is not consuming queued commands.
- `.flovart/command-queue.json` appears stale.
- Agent host configuration may be missing.

The Provider readiness fields in `doctor` come from shadow metadata for offline diagnostics. Use `provider.status` for the browser UI's authoritative Provider state.

## command.list

Return machine-readable command metadata.

```bash
npm run flovart:cli -- command.list --json
```

Use this instead of guessing command availability.

## command.schema

Return one command schema.

```bash
npm run flovart:cli -- command.schema --command canvas.inspect --json
```

If a command accepts JSON payloads, check schema first and prefer `--file` for larger payloads.
