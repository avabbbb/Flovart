# Example: Diagnose and Repair Existing Canvas

Use when the user provides an existing Flovart state or says a project is broken.

## Diagnose First

```bash
npm run flovart:cli -- status --json
npm run flovart:cli -- canvas.inspect --json
npm run flovart:cli -- workflow.inspect --json
npm run flovart:cli -- asset.list --json
```

Check:

- Empty media elements.
- Failed generation states.
- Video elements with no source images.
- Prompts that reference missing `@names`.
- Jobs still queued or running.
- Workflow nodes with missing config or broken edges.

## Repair Plan

Return a minimal repair list before acting when user approval is needed:

- Element ID or node ID.
- Problem.
- Smallest patch.
- Whether retry consumes provider credits.

## Apply Repair

Patch prompt:

```bash
npm run flovart:cli -- element.update-prompt --element-id <id> --text-prompt "clearer prompt..." --json
```

Patch source slot:

```bash
npm run flovart:cli -- element.assign-slot --element-id <target> --target-element-id <source> --slot-role first_frame --json
```

Retry one element:

```bash
npm run flovart:cli -- element.ignite --element-id <id> --wait --timeout-ms 120000 --json
```

Patch one workflow node:

```bash
npm run flovart:cli -- workflow.update-node --nodeId <node-id> --config-json "{\"prompt\":\"updated prompt\"}" --json
```
