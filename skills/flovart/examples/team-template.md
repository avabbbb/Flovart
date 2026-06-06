# Example: Team Production Template

Use when a team wants a reusable short-video production canvas.

## Canvas Columns

- Inputs: references, brand constraints, user brief.
- Planning: story outline, script, unit list.
- Visual assets: characters, scenes, props.
- Unit images: one keyframe per unit.
- Unit videos: one video per unit.
- QA and retry: failed elements, notes, repair plan.
- Final output: selected videos and export notes.

## Create Template Notes

```bash
npm run flovart:cli -- element.create --type text --name "template-brief" --x 80 --y 120 --width 320 --height 220 --json
npm run flovart:cli -- element.create --type text --name "template-script" --x 420 --y 120 --width 360 --height 260 --json
npm run flovart:cli -- element.create --type text --name "template-units" --x 420 --y 420 --width 360 --height 320 --json
npm run flovart:cli -- element.create --type text --name "template-qa-retry" --x 1600 --y 120 --width 360 --height 260 --json
```

Update each text element with concise team instructions:

```bash
npm run flovart:cli -- canvas.update-element --id <id> --updates-json "{\"text\":\"Paste the user brief, target platform, aspect ratio, duration, required assets, and hard constraints here.\"}" --json
```

## Add Empty Media Slots

```bash
npm run flovart:cli -- element.create --type image --name "character-ref-slot" --x 840 --y 120 --width 240 --height 240 --json
npm run flovart:cli -- element.create --type image --name "unit-01-keyframe-slot" --x 1120 --y 120 --width 320 --height 180 --json
npm run flovart:cli -- element.create --type video --name "unit-01-video-slot" --x 1480 --y 120 --width 320 --height 180 --json
```

## Delivery

Return the element map and explain which slots should be filled by humans before generation.
