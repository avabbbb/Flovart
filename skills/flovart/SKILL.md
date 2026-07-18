---
name: flovart
description: Operate Flovart Workflow projects, nodes, providers, product models, assets, and generation jobs through the deterministic local CLI or its MCP wrapper. Use when an agent needs to inspect or change Flovart production state, run image or video generation, diagnose provider readiness, or export project metadata. The current CLI command surface covers Workflow, not Table; never invent removed Canvas or Element commands, and do not claim Table automation until it appears in command.list.
---

# Flovart CLI

Use the local deterministic CLI for every Flovart mutation. In an installed Toolkit:

```bash
npx flovart-cli <command> --json
```

Source contributors may use `npm run flovart:cli -- <command> --json` inside the repository.

Treat these outputs as the only source of truth for names and arguments:

```bash
npx flovart-cli command.list --json
npx flovart-cli command.schema --command <command> --json
```

If this file or another reference disagrees with the registry, trust the registry and stop using the stale command.

## Product boundary

- Workflow is the current automated generation workspace.
- Table is the official second workspace for agent storyboards and media preprocessing, but it has no registered CLI commands yet.
- Canvas and Art are removed product workspaces. Do not call `canvas.*`, `element.*`, or their old aliases.
- Do not turn a user request for Table into Workflow state unless the user explicitly asks for that fallback.

## Safety rules

- Let the external agent plan scripts, shots, prompts, retries, and delivery; use Flovart only for deterministic state changes and generation.
- Never read, print, copy, or store API keys. Provider credentials stay in the local Flovart Runtime/WebUI.
- Keep the local Flovart Runtime/WebUI running for provider-backed commands.
- Do not invent private HTTP calls, scrape the UI, or add another protocol server.
- Inspect before mutation, send explicit prompts and typed arguments, and retry only the smallest failed node or job.
- Do not submit a duplicate long-running job until its current status is known.

## Setup

```bash
npx flovart-cli install
npx flovart-cli start
npx flovart-cli status --json
npx flovart-cli provider.status --json
```

If setup is incomplete:

```bash
npx flovart-cli provider.begin-setup --purpose both --json
```

Ask the user to enter credentials in the local Runtime/WebUI. Never request a key in chat.

## MCP wrapper

Register the same MCP server when the host supports MCP:

```bash
npx flovart-cli init --host codex
```

Use `--host claude|opencode|cursor|windsurf|vscode|all` for another host. It exposes the same canonical registry through stdio. MCP tool names replace dots and hyphens with underscores. The MCP wrapper does not expand the command surface.

## Operating workflow

1. Read `command.list`, then read the schema for each command you will call.
2. Run `status` and `provider.status`.
3. Select or create a Workflow project with `workflow.project.*`.
4. Inspect the redacted graph with `workflow.inspect`.
5. Create, update, connect, move, resize, or select nodes using registered `workflow.*` commands.
6. Run a config node with `workflow.node.run`, or use `generate.image`, `generate.images-batch`, or `generate.video` when their schemas match the task.
7. Use `workflow.node.stop` or `video.status` for active work.
8. Re-inspect and return project, node, connection, artifact, and job IDs plus any remaining user action.

Example discovery and graph setup:

```bash
npx flovart-cli command.schema --command workflow.node.create --json
npx flovart-cli workflow.project.create --title "产品视频" --json
npx flovart-cli workflow.node.create --type text --title "创作 Brief" --x 80 --y 120 --json
npx flovart-cli workflow.inspect --json
```

Never copy arguments such as `--wait`, `--place-on-canvas`, or `--duration` from old examples without confirming they exist in the current schema.

## Delivery

Report:

- what changed in the Workflow;
- important project, node, connection, artifact, and job IDs;
- failed or pending work with the smallest retry plan;
- any browser action needed for provider setup;
- that Table automation is unavailable when the requested Table command is not registered.
