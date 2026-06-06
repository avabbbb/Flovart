# Canvas Element Types

Flovart's external agent interface treats canvas elements as explicit records. Use CLI commands to create, patch, reference, and generate them.

## Type Map

| Type | Command support | Purpose | Main fields |
| --- | --- | --- | --- |
| `image` | `element.create`, `canvas.add-image`, `canvas.upload-image`, `generate.image` | Reference images, generated keyframes, visual assets | `href`, `mimeType`, `width`, `height`, `generationState` |
| `video` | `element.create`, `canvas.add-video`, `canvas.upload-video`, `generate.video` | Reference clips and generated shots | `href`, `mimeType`, `poster`, `durationSec`, `generationState` |
| `text` | `element.create`, `canvas.update-element` | Canvas annotations, scripts, shot notes, template instructions | `text`, `fontSize`, `fontColor`, `width`, `height` |
| `shape` | inspect/update only in app state | Visual structure and UI-created canvas shapes | `shapeType`, `width`, `height`, `fillColor`, `strokeColor` |

Read the specific file when needed:

- `image.md`
- `video.md`
- `text.md`
- `shape.md`
- `workflow.md`

## Generation Fields

Generated media uses `generationState`:

```json
{
  "promptPayload": {
    "rawText": "cinematic keyframe using @character-a-ref",
    "resolvedReferences": []
  },
  "provider": "openrouter",
  "modelId": "flux-schnell",
  "aspectRatio": "16:9",
  "status": "idle"
}
```

Patch with:

```bash
npm run flovart:cli -- element.update-prompt --element-id <id> --text-prompt "..." --json
npm run flovart:cli -- element.assign-slot --element-id <target> --target-element-id <source> --slot-role first_frame --json
```

## Layout Convention for Agent-Created Canvases

For storyboard or video projects, use stable columns:

- Input/reference area: `x = 0..360`
- Script/storyboard planning: `x = 420..760`
- Image/keyframe generation: `x = 840..1180`
- Video generation/final output: `x = 1260..1660`

Keep names stable and machine-readable, for example `unit-03-keyframe` and `unit-03-video`.
