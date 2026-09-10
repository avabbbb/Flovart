---
name: flovart
description: Use Flovart's visible Workflow through its stable Agent surface. Use when an agent must prepare the workspace, inspect the current graph, read selection, apply document changes, or run a Workflow node.
---

# Flovart

Flovart is the visible Workflow authority. The Link layer prepares the local
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

The stable commands are `ensure`, `status`, `workflow.inspect`,
`workflow.selection.get`, `workflow.apply`, and `workflow.node.run`.

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

## Intent mapping

- “打开 Flovart” → `ensure`, then `workflow.inspect`.
- “查看当前 Workflow” → `workflow.inspect`.
- “当前选择” → `workflow.selection.get`.
- Add, delete, move, resize, connect, disconnect, or edit → one `workflow.apply`.
- Run a node → `workflow.node.run` after confirming the node from inspection.

The UI and Flovart Core own Provider routing, credentials, cost confirmation,
resource resolution, and artifacts. Do not call a Provider directly, store
credentials, modify browser storage, use private routes, or create a second
Workflow runtime. A missing reference or unsupported input must remain an
explicit failure; never downgrade the requested media mode silently.
