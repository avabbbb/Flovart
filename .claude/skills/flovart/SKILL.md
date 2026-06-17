---
name: flovart
description: Use when Claude Code needs to operate Flovart as an agent-native media runtime. Flovart generates and manages images/videos through deterministic CLI commands. Claude Code handles scripts, storyboards, prompts, and planning. CLI is the universal interface.
---

# Flovart Skill

Flovart is a deterministic media runtime. You are the planner. All operations go through `npm run flovart:cli -- <command> --json`.

## Runtime Setup

1. `npm run dev`
2. Open Flovart in the browser when a command needs provider execution
3. `npm run flovart:cli -- status --json`

Without a browser, commands fall back to **shadow runtime** — state persists to disk and executes when the browser opens.

## Rules

- Never ask the user to paste API keys. Use `provider.begin-setup` to open the browser UI.
- Do not add text nodes to the Flovart canvas. Canvas is media-only: images and videos.
- Use CLI as the only external interface. No protocol server or CDP port is required.
- Keep all tool calls explicit and JSON-safe.

## Atomic CLI Commands

### Status & Setup
| Command | Args |
|---------|------|
| `status` | — |
| `doctor` | `--project-dir` |
| `init` | `--host claude\|cursor\|vscode\|all` |
| `command.list` | — |

### Provider & API Keys
| Command | Args |
|---------|------|
| `provider.status` | — |
| `provider.begin-setup` | `--provider gemini\|openai\|custom --purpose image\|video\|both` |
| `provider.select-model` | `--image-model <id> --video-model <id> --text-model <id>` |
| `provider.test` | `--purpose image\|video\|both` |

### Canvas — Media Elements
| Command | Args |
|---------|------|
| `canvas.inspect` | — |
| `canvas.list-media` | — |
| `canvas.add-image` | `--href <data-url-or-url> --mime-type image/png [--name <name> --x 0 --y 0]` |
| `canvas.add-video` | `--href <data-url-or-url> --mime-type video/mp4 [--name <name>]` |
| `canvas.upload-image` | `--path <local-file-path> [--name <name>]` |
| `canvas.upload-video` | `--path <local-file-path> [--name <name>]` |
| `canvas.update-element` | `--id <id> --updates-json <json>` |
| `canvas.remove-element` | `--id <id>` |
| `canvas.select` | `--ids id1,id2` |
| `canvas.clear-media` | — |

### Element Generation
| Command | Args |
|---------|------|
| `element.create` | `--type image\|video --name <name> [--x 0 --y 0 --href <url>]` |
| `element.update-prompt` | `--element-id <id> --text-prompt "<prompt>" [--model-id <id>]` |
| `element.assign-slot` | `--element-id <id> --target-element-id <id> --slot-role first_frame\|style_ref\|control_net\|unassigned` |
| `element.ignite` | `--element-id <id>` |
| `element.watch` | `--element-id <id> [--timeout-ms 120000]` |

### Generation (One-Shot)
| Command | Args |
|---------|------|
| `generate.image` | `--prompt "<prompt>" [--aspect-ratio 16:9]` |
| `generate.images-batch` | `--file shots.json` |
| `generate.video` | `--prompt "<prompt>" [--source-image-ids id1,id2 --duration-sec 5 --aspect-ratio 16:9]` |
| `video.status` | `--job-id <id>` |

### Workflow — Graph Operations
| Command | Args |
|---------|------|
| `workflow.inspect` | — |
| `workflow.load` | `--file workflow.json` or `--workflow-json '<json>'` |
| `workflow.update-node` | `--node-id <id> --config-json '<json>'` |
| `workflow.run` | `[--scope workflow\|node\|from-here --node-id <id>]` |
| `workflow.plan-video` | `--prompt "<prompt>" [--count 3 --aspect-ratio 16:9 --duration-sec 5 --image-model flux-schnell --video-model kling-v2]` |

### Planning & Discovery
| Command | Args |
|---------|------|
| `batch.plan` | `--prompt "<prompt>" [--count 4 --aspect-ratio 16:9]` |
| `prompt.enhance` | `--prompt "<prompt>" [--style cinematic --mode image\|video]` |
| `models.list` | `--purpose image\|video\|all` |
| `preferences.manage` | `--action get\|set\|reset\|add-favorite` |
| `inspiration.search` | `--query <term> [--category <cat>]` |
| `inspiration.get` | `--id <id>` |

## Workflows

### Quick Image Generation
```bash
npm run flovart:cli -- generate.image --prompt "futuristic city at sunset" --json
```

### Upload Local Media
```bash
npm run flovart:cli -- canvas.upload-image --path "C:\Users\me\Pictures\ref.png" --name "Reference" --json
```

### Batch Storyboard
```bash
npm run flovart:cli -- batch.plan --prompt "product launch campaign" --count 4 --json
# save shots to file, edit prompts, then:
npm run flovart:cli -- generate.images-batch --file shots.json --json
```

### Custom Video Workflow (Agent-Planned)
```bash
# 1. Generate a multi-shot video workflow graph
npm run flovart:cli -- workflow.plan-video --prompt "cyberpunk street chase" --count 4 --duration-sec 5 --json > workflow.json

# 2. Load the workflow into the canvas
npm run flovart:cli -- workflow.load --file workflow.json --json

# 3. Inspect
npm run flovart:cli -- workflow.inspect --json

# 4. Tweak a node's model
npm run flovart:cli -- workflow.update-node --node-id "shot-2-video" --config-json '{"model":"veo-3"}' --json

# 5. Run the whole graph
npm run flovart:cli -- workflow.run --scope workflow --json
```

### Per-Node Model / API Key Control
```bash
# Set model on any workflow node
npm run flovart:cli -- workflow.update-node --node-id "shot-1-image" --config-json '{"model":"gpt-image-2","apiKeyRef":"key-abc123"}' --json
```

## Shadow Runtime (No Browser)

CLI data commands use the local file-state runtime at `%LOCALAPPDATA%\Flovart\shadow-runtime-state.json`. Provider-backed generation requests are queued through `.flovart/command-queue.json` and execute when the Flovart browser app is open.

```bash
npm run flovart:cli -- status --json
# => { "ok": true, "runtime": "file-state", "data": { "runtime": "flovart-shadow-runtime", ... } }
```
