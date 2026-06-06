# Example: Short Drama Episode

Use when the user asks for a 60-90 second short drama, micro drama, or episodic video plan.

## Agent Planning

Create outside the CLI first:

- One-sentence premise.
- Hook, protagonist goal, obstacle, reversal, cliffhanger.
- 6-10 units with duration, shot content, camera, action, emotion, sound/subtitle cue.
- Character and scene reference prompts.

## Canvas Build

```bash
npm run flovart:cli -- status --json
npm run flovart:cli -- provider.status --json
npm run flovart:cli -- canvas.inspect --json
```

Create visible planning notes only if requested:

```bash
npm run flovart:cli -- element.create --type text --name "episode-01-outline" --x 420 --y 120 --width 380 --height 260 --json
npm run flovart:cli -- element.create --type text --name "episode-01-units" --x 420 --y 420 --width 380 --height 360 --json
```

Create one image and one video element per unit:

```bash
npm run flovart:cli -- element.create --type image --name "unit-01-keyframe" --x 840 --y 120 --width 320 --height 180 --json
npm run flovart:cli -- element.create --type video --name "unit-01-video" --x 1260 --y 120 --width 320 --height 180 --json
```

Attach prompts:

```bash
npm run flovart:cli -- element.update-prompt --element-id <keyframe-id> --text-prompt "Unit 01 keyframe: ..." --json
npm run flovart:cli -- element.assign-slot --element-id <video-id> --target-element-id <keyframe-id> --slot-role first_frame --json
```

## Generation Order

1. Character references.
2. Scene references.
3. Unit keyframes.
4. Unit videos.

Do not rerun the whole episode when one unit fails. Inspect that unit, patch prompt/source IDs, and retry only that unit.
