---
name: flovart
description: Flovart official agent skill. Use when operating Flovart canvas, media, workflow, providers, models, assets, or project state through the deterministic Flovart CLI. External agents plan; Flovart CLI executes explicit commands. Do not invent HTTP calls, scrape the UI, or expose API keys.
---

# Flovart CLI Skill

Flovart is an AI Canvas Studio runtime for images, videos, workflows, storyboards, assets, and publish review. Agents should operate it through the local deterministic CLI:

```bash
npm run flovart:cli -- <command> --json
```

The source of truth for command names and options is:

```bash
npm run flovart:cli -- command.list --json
npm run flovart:cli -- command.schema --command <command> --json
```

If this skill disagrees with `command.list` or `command.schema`, trust the CLI output and update the skill docs.

CLI aliases are accepted for atomic canvas orchestration:

```bash
npm run flovart:cli -- flovart_element_create --type image --name keyframe --json
npm run flovart:cli -- flovart_element_update_prompt --element-id <id> --text-prompt "..." --json
npm run flovart:cli -- flovart_element_assign_slot --element-id <id> --target-element-id <ref-id> --slot-role reference_image --json
npm run flovart:cli -- flovart_element_ignite --element-id <id> --wait --json
npm run flovart:cli -- flovart_generate_video --prompt "..." --source-image-ids img1,img2 --source-video-ids vid1 --json
```

## Non-Negotiable Rules

- Flovart is not the planner. The external agent writes scripts, shot lists, prompts, retry strategy, and final summaries.
- Use the CLI for canvas/project/model/media operations. Do not hand-roll private HTTP requests or add protocol servers.
- Never read, print, copy, or store API keys in CLI output or chat transcripts.
- Provider-backed generation requires the browser UI because keys stay in browser storage.
- Canvas automation for external agents is media-first. Prefer image/video elements for production artifacts; use text elements only when explicitly documenting canvas structure.
- Send explicit prompts and structured JSON. Do not pass vague natural-language instructions into deterministic commands.
- For slow or failed jobs, inspect status and patch the smallest affected element or workflow node. Do not rebuild the whole canvas by default.

## Setup

1. Run `npm install` if dependencies are missing.
2. Run `npm run dev`.
3. Keep the Flovart browser tab open for provider-backed commands.
4. Check local state:

```bash
npm run flovart:cli -- status --json
```

5. If models or providers are missing, open safe setup:

```bash
npm run flovart:cli -- provider.begin-setup --purpose both --json
```

## Runtime Modes

- `file-state`: local shadow runtime. Supports canvas inspection, media add/update/select/remove, workflow load/update, provider model selection, and export metadata without a browser.
- `file-bridge`: queued browser execution. Used for image/video generation, workflow run, and element ignite. The Vite app polls `.flovart/command-queue.json` through `/__flovart/queue`.
- Browser UI: the only place API keys are entered and used.

## Documentation Map

Read only the file needed for the current task.

| Topic | File |
| --- | --- |
| Install, setup, host init | `../../../skills/flovart/scripts/install.md` |
| Project context | `../../../skills/flovart/commands/project.md` |
| Group context | `../../../skills/flovart/commands/group.md` |
| LibTV-style node operations | `../../../skills/flovart/commands/node.md` |
| Upload local media | `../../../skills/flovart/commands/upload.md` |
| Runtime status and diagnostics | `../../../skills/flovart/commands/status.md` |
| Provider setup, model selection, readiness | `../../../skills/flovart/commands/provider.md` |
| Canvas inspect, media upload/add/update/remove | `../../../skills/flovart/commands/canvas.md` |
| Element create, prompt, slots, ignite, watch | `../../../skills/flovart/commands/element.md` |
| Workflow inspect/load/update/run | `../../../skills/flovart/commands/workflow.md` |
| Assets, generated history, project export | `../../../skills/flovart/commands/asset.md` |
| Image/video generation commands | `../../../skills/flovart/commands/generate.md` |
| Image shortcuts | `../../../skills/flovart/commands/image.md` |
| Script/storyboard commands | `../../../skills/flovart/commands/script.md` |
| Prompt helpers, model list, preferences | `../../../skills/flovart/commands/model.md` |
| Canvas element types | `../../../skills/flovart/node-types/README.md` |
| Model and provider schema notes | `../../../skills/flovart/model-schema/schema.md` |
| Common end-to-end cases | `../../../skills/flovart/examples/README.md` |

## Common Workflows

### Inspect Before Acting

```bash
npm run flovart:cli -- status --json
npm run flovart:cli -- canvas.inspect --json
npm run flovart:cli -- provider.status --json
```

### Add Reference Media

```bash
npm run flovart:cli -- canvas.upload-image --path "C:/absolute/ref.png" --name "character-a-ref" --x 120 --y 160 --json
```

### Create a Generated Image Element

```bash
npm run flovart:cli -- element.create --type image --name "unit-01-keyframe" --x 520 --y 160 --width 320 --height 180 --json
npm run flovart:cli -- element.update-prompt --element-id <id> --text-prompt "cinematic keyframe..." --json
npm run flovart:cli -- element.ignite --element-id <id> --wait --timeout-ms 120000 --json
```

### Generate Directly

```bash
npm run flovart:cli -- generate.image --prompt "premium product hero shot..." --aspect-ratio 16:9 --place-on-canvas true --wait --json
npm run flovart:cli -- generate.video --prompt "8 second locked-off product reveal..." --source-image-ids id1,id2 --duration 8 --aspect-ratio 16:9 --wait --json
```

For Seedance-style models, `generate.video` accepts multimodal slots. Prefer existing canvas IDs when possible; use `--slots-json` for external URLs or data URLs:

```bash
npm run flovart:cli -- generate.video --prompt "8 second scene..." --source-image-ids roleA,roleB --source-video-ids motionRef --duration 8 --resolution 1080p --json
npm run flovart:cli -- generate.video --prompt "8 second scene..." --slots-json "[{\"kind\":\"image\",\"href\":\"https://example.com/a.png\",\"mimeType\":\"image/png\",\"role\":\"reference_image\"},{\"kind\":\"video\",\"href\":\"https://example.com/ref.mp4\",\"mimeType\":\"video/mp4\",\"role\":\"reference_video\"}]" --json
```

Supported slot kinds are `image`, `video`, and `audio`. The gateway filters slot roles and request parameters through the selected model capability dictionary before calling the provider.

## Delivery Checklist

For creative jobs, return:

- What was created or changed on the canvas.
- Main media element IDs, job IDs, and output URLs when available.
- Failed or pending nodes with the smallest retry plan.
- Any user action needed in the browser UI, especially provider setup.
