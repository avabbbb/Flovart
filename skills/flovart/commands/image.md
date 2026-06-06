# Image Shortcut Commands

Image shortcuts are deterministic prompt presets for common image node tasks.

## image.shortcut list

```bash
npm run flovart:cli -- image.shortcut list --json
npm run flovart:cli -- image.shortcut.list --json
```

Current presets:

- `product-hero`
- `character-board`
- `cinematic-keyframe`
- `scene-establishing`

## image.shortcut

Apply one shortcut to an image node.

```bash
npm run flovart:cli -- image.shortcut product-hero -n <nodeId> --json
npm run flovart:cli -- image.shortcut cinematic-keyframe -n <nodeId> --run --json
```

`-n` means node ID for this command. The command patches the node prompt and optionally queues generation with `--run`.
