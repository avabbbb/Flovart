# Element Commands

Element commands are for creating media/text nodes, attaching prompts, assigning references, and queuing generation.

## element.create

Create an element.

```bash
npm run flovart:cli -- element.create --type image --name "unit-01-keyframe" --x 520 --y 160 --width 320 --height 180 --json
npm run flovart:cli -- element.create --type video --name "unit-01-video" --x 900 --y 160 --width 320 --height 180 --json
npm run flovart:cli -- element.create --type text --name "story-outline" --x 120 --y 120 --width 360 --height 180 --json
```

Allowed `type`: `image`, `video`, `text`.

## element.update-prompt

Update a media element prompt and hydrate `@name` references.

```bash
npm run flovart:cli -- element.update-prompt --element-id <image-id> --text-prompt "cinematic keyframe using @character-a-ref as identity reference" --model-id flux-schnell --json
```

Use element names that are stable and unique if you plan to reference them with `@`.

## element.assign-slot

Assign a referenced element to an explicit generation slot role.

```bash
npm run flovart:cli -- element.assign-slot --element-id <video-id> --target-element-id <image-id> --slot-role first_frame --json
```

Allowed slot roles:

- `first_frame`
- `style_ref`
- `control_net`
- `unassigned`

## element.ignite

Queue generation for one media element. This is a browser-backed command.

```bash
npm run flovart:cli -- element.ignite --element-id <image-id> --wait --timeout-ms 120000 --json
```

Without the browser UI, the command may be queued or stored in the shadow runtime but provider jobs will not complete.

## element.watch

Wait for or inspect one element's generation state.

```bash
npm run flovart:cli -- element.watch --element-id <image-id> --timeoutMs 120000 --json
```

If the element fails, patch only the prompt, references, model, or affected slot, then retry that element.
