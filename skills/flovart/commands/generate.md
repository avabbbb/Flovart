# Generation Commands

Generation commands are browser-backed. Keep the Flovart browser tab open and make sure provider setup is complete.

Check first:

```bash
npm run flovart:cli -- provider.status --json
npm run flovart:cli -- provider.test --purpose both --json
```

## generate.image

Generate one image from an explicit prompt.

```bash
npm run flovart:cli -- generate.image --prompt "cinematic product poster, clean hero composition" --aspect-ratio 16:9 --place-on-canvas true --wait --timeout-ms 120000 --json
```

Arguments:

- `prompt`: required.
- `aspect-ratio`: optional, commonly `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9`.
- `place-on-canvas`: optional boolean.

## generate.images-batch

Generate multiple images from explicit prompt items.

```bash
npm run flovart:cli -- generate.images-batch --file shots.json --place-on-canvas true --layout grid --wait --timeout-ms 180000 --json
```

Example `shots.json`:

```json
{
  "items": [
    { "name": "unit-01-keyframe", "prompt": "wide office morning, protagonist at desk", "aspectRatio": "16:9" },
    { "name": "unit-02-keyframe", "prompt": "close-up phone notification, tense mood", "aspectRatio": "16:9" }
  ]
}
```

## generate.video

Generate one video from a prompt and optional source image IDs.

```bash
npm run flovart:cli -- generate.video --prompt "8 second slow dolly-in, character turns toward camera" --source-image-ids image1,image2 --duration 8 --aspect-ratio 16:9 --wait --timeout-ms 300000 --json
```

Prompt requirements:

- Describe start frame, end frame, subject motion, camera motion, and continuity constraints.
- If using source images, state each image's role in the prompt.
- Keep retry scope small: patch prompt or source IDs, then rerun only the failed video.
