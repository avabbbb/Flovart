# Canvas Commands

Canvas commands operate on local canvas state and media elements.

## canvas.inspect

Inspect elements, selection, viewport, media, jobs, and provider state.

```bash
npm run flovart:cli -- canvas.inspect --json
```

Use it before adding, deleting, selecting, or retrying elements.

## canvas.list-media

List image and video elements only.

```bash
npm run flovart:cli -- canvas.list-media --json
```

Use when generation or video assembly needs media IDs.

## canvas.add-image

Add an image element from an existing URL or data URL.

```bash
npm run flovart:cli -- canvas.add-image --href "data:image/png;base64,..." --mime-type image/png --name "hero-reference" --x 120 --y 120 --width 320 --height 180 --json
```

## canvas.upload-image

Read a local image file and add it to the canvas.

```bash
npm run flovart:cli -- canvas.upload-image --path "C:/absolute/ref.png" --name "character-a-ref" --x 120 --y 160 --json
```

## canvas.add-video

Add a video element from an existing URL or data URL.

```bash
npm run flovart:cli -- canvas.add-video --href "https://example.com/clip.mp4" --mime-type video/mp4 --name "reference-video" --x 120 --y 420 --width 320 --height 180 --json
```

## canvas.upload-video

Read a local video file and add it to the canvas.

```bash
npm run flovart:cli -- canvas.upload-video --path "C:/absolute/ref.mp4" --name "rhythm-reference" --x 120 --y 420 --json
```

## canvas.update-element

Patch one element with explicit JSON.

```bash
npm run flovart:cli -- canvas.update-element --id <element-id> --updates-json "{\"x\":520,\"y\":160,\"name\":\"unit-01-keyframe\"}" --json
```

Blocked fields: `id`, `type`.

## canvas.select

Replace current selection.

```bash
npm run flovart:cli -- canvas.select --ids id1,id2 --json
```

## canvas.remove-element

Remove one element.

```bash
npm run flovart:cli -- canvas.remove-element --id <element-id> --json
```

## canvas.clear-media

Remove image/video elements only.

```bash
npm run flovart:cli -- canvas.clear-media --json
```

Use with care. Inspect first and summarize the destructive scope to the user when the canvas has important media.
