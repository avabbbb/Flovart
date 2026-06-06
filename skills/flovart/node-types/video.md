# Node Type: video

Video elements represent uploaded reference clips, generated unit shots, and final output candidates.

## Create Empty Video Element

```bash
npm run flovart:cli -- element.create --type video --name "unit-01-video" --x 1260 --y 160 --width 320 --height 180 --json
```

## Add Existing Video

```bash
npm run flovart:cli -- canvas.upload-video --path "C:/absolute/reference.mp4" --name "rhythm-reference" --x 120 --y 420 --json
```

## Attach First Frame or Reference

```bash
npm run flovart:cli -- element.assign-slot --element-id <video-id> --target-element-id <image-id> --slot-role first_frame --json
```

## Generate

```bash
npm run flovart:cli -- generate.video --prompt "8 seconds, starts on the uploaded keyframe, slow dolly in, subject turns toward camera, preserve face and outfit" --source-image-ids <image-id> --duration 8 --aspect-ratio 16:9 --wait --timeout-ms 300000 --json
```

## Prompt Requirements

- Include duration, start frame, end frame, subject action, camera movement, and continuity constraints.
- Explain every source image role.
- Avoid vague prompt-only story summaries. Write what should be visible and how it moves.
