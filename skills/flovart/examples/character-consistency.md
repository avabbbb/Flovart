# Example: Multi-Reference Character Consistency

Use when the user provides character and scene references and asks for a video that preserves identities.

## Upload References

```bash
npm run flovart:cli -- canvas.upload-image --path "C:/absolute/character-a.png" --name "character-a-ref" --x 120 --y 120 --json
npm run flovart:cli -- canvas.upload-image --path "C:/absolute/character-b.png" --name "character-b-ref" --x 120 --y 360 --json
npm run flovart:cli -- canvas.upload-image --path "C:/absolute/room.png" --name "room-ref" --x 120 --y 600 --json
```

## Create Keyframe

```bash
npm run flovart:cli -- element.create --type image --name "dialogue-scene-keyframe" --x 840 --y 160 --width 320 --height 180 --json
npm run flovart:cli -- element.update-prompt --element-id <keyframe-id> --text-prompt "Two-person dialogue keyframe. Use @character-a-ref for the person standing at the doorway, @character-b-ref for the seated person at the desk, @room-ref for room layout. Preserve identities, do not merge faces." --json
npm run flovart:cli -- element.assign-slot --element-id <keyframe-id> --target-element-id <character-a-id> --slot-role style_ref --json
npm run flovart:cli -- element.assign-slot --element-id <keyframe-id> --target-element-id <character-b-id> --slot-role style_ref --json
npm run flovart:cli -- element.assign-slot --element-id <keyframe-id> --target-element-id <room-id> --slot-role control_net --json
```

## Generate Video

```bash
npm run flovart:cli -- generate.video --prompt "8-12 second dialogue video. Character A stands at the doorway, hesitates, then enters. Character B sits at the desk and looks up. Preserve character A from character-a-ref, character B from character-b-ref, and room direction from room-ref. Do not swap identities, merge faces, or change room layout." --source-image-ids <keyframe-id>,<character-a-id>,<character-b-id>,<room-id> --duration 10 --aspect-ratio 16:9 --wait --timeout-ms 300000 --json
```

## Delivery

Return reference order, generated keyframe ID, video job/output, and any identity consistency risks.
