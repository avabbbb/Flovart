# Flovart Agent and CLI Bridge Design

## Decision

Flovart should keep one external automation boundary: the deterministic CLI.

Do not add stdio tool servers or agent-host-specific protocol layers inside Flovart. Codex, Claude Code, OpenCode, Cursor, and similar hosts can call the CLI as a normal command. They remain the planners; Flovart remains the executor.

## What to learn from infinite-canvas

The useful part of `basketikun/infinite-canvas` is the product loop, not the protocol choice:

1. The user starts a local helper from the terminal.
2. The helper prints a local address or clear setup status.
3. The web app has a visible Agent panel with connection, chat, history, and logs.
4. Tool calls and canvas mutations are explainable and confirmable.
5. The user can copy diagnostics when something breaks.

Flovart should adopt that clarity while staying CLI-only.

## Current Flovart shape

- `tools/flovart/core.js` is the command registry and execution surface.
- `tools/flovart/cli.js` routes commands to local file-state runtime or browser queue.
- `tools/flovart/flovart-bridge.js` is the Vite file bridge using `.flovart/command-queue.json`.
- `tools/flovart/shadow-runtime.js` lets many canvas/media commands run without a browser.
- Provider-backed generation still requires the browser, so API keys stay in browser storage.

## CLI install story

The nested CLI package should be publishable as `flovart-cli`.

Recommended commands:

```bash
npx -y flovart-cli status --json
npx -y flovart-cli command.list --json
npx -y flovart-cli canvas.inspect --json
npx -y flovart-cli generate.image --prompt "..." --json
```

Local development stays:

```bash
npm run flovart:cli -- status --json
npm run flovart:cli -- command.list --json
```

## Agent UI direction

The Agent panel should be a CLI control console, not a chat agent runtime hidden inside Flovart.

Recommended tabs:

- Setup: dev server status, browser bridge status, `npx flovart-cli` install command, `doctor` result.
- Run: command palette for common CLI actions, generated exact command preview, copy/run affordances.
- History: recent queue entries, media jobs, saved assets, and generated command invocations.
- Log: command output, queue state, provider readiness, compact diagnostics.

The UI should be restrained and operational: compact rows, small badges, expandable JSON details, and clear failure states.

## Port/address meaning

If Flovart later prints a local address, it should mean only the browser bridge or dev server address, not a new protocol server. Example:

```text
Flovart dev server: http://127.0.0.1:5173
Bridge queue: .flovart/command-queue.json
CLI: npx -y flovart-cli status --json
```

The local address helps the user know which browser tab must stay open for provider-backed generation. It should not imply that API keys are exposed to Node or that Flovart runs a remote service.

## Host integration

OpenCode, Claude Code, Codex, Cursor, and other coding agents should integrate by running explicit CLI commands:

```bash
npx -y flovart-cli command.schema --command generate.image --json
npx -y flovart-cli generate.image --prompt "cinematic keyframe..." --place-on-canvas true --json
```

Host-specific helper config can point to `node tools/flovart/cli.js`, but it should remain a CLI command config, not a tool server config.

## Product constraint

Agent tools should express Flovart's real workflow:

import reference image -> @ reference media node -> generate 4 variants -> compare -> save asset -> let Agent extend shots or video.

External automation should stay canvas/media/provider-first. Do not add text-node/storyboard protocol bias unless the user explicitly asks for text nodes as canvas artifacts.
