---
name: open-flovart
description: Prepare Flovart for a user's Workflow task. Use when a user asks to open Flovart or make it ready for workflow work.
---

# Open Flovart

Flovart manages its local service, browser workspace, short-lived credentials,
and recovery internally. Do not ask the user for connection details and do not
recreate a connection flow in the conversation.

## Normal loop

Run the lifecycle command first:

```bash
flovart ensure --json
```

When working directly from this source checkout, use the repository entrypoint
if the packaged `flovart` command is not installed:

```bash
npm run flovart:cli -- ensure --json
```

Do not use `npx flovart-cli` as an automatic fallback; an unpublished source
checkout can make `npx` query an unrelated registry package.

Continue only when the result has `ok: true` and `state: "ready"`. If it is
not ready, report the returned public state and error action; do not guess a
port, open a private URL, read a local config file, or retry with a new token.

Then hand the task to the stable Flovart Skill:

```bash
flovart workflow.inspect --json
```

Use `npm run flovart:cli -- workflow.inspect --json` for the same source-checkout fallback.

Use `workflow.selection.get` when the request depends on the current
selection. Use one `workflow.apply` for related graph edits, and
`workflow.node.run` only after confirming the node and revision. Keep the same
`mutationId` and `idempotencyKey` when retrying a write.

## Prohibited shortcuts

- Do not read Agent configuration, tokens, ports, or private Runtime files.
- Do not call a Provider directly or write browser storage.
- Do not use MCP, CDP, browser scraping, React setters, or a hidden Workflow copy.
- Do not choose another project when the visible workspace is unavailable or its revision changed.
