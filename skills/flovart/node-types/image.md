# Node Type: image

Image elements represent uploaded references, generated keyframes, product shots, style boards, character references, and intermediate visual assets.

## Create Empty Image Element

```bash
npm run flovart:cli -- element.create --type image --name "unit-01-keyframe" --x 840 --y 160 --width 320 --height 180 --json
```

Then attach prompt:

```bash
npm run flovart:cli -- element.update-prompt --element-id <id> --text-prompt "wide cinematic office shot, protagonist at desk, morning light" --model-id flux-schnell --json
```

## Add Existing Image

```bash
npm run flovart:cli -- canvas.upload-image --path "C:/absolute/product.png" --name "product-ref" --x 120 --y 160 --json
```

## Generate

```bash
npm run flovart:cli -- element.ignite --element-id <id> --wait --timeout-ms 120000 --json
```

or:

```bash
npm run flovart:cli -- generate.image --prompt "premium product hero shot" --aspect-ratio 16:9 --place-on-canvas true --wait --json
```

## Prompt Requirements

- State subject, composition, lighting, style, and intended use.
- If referencing another element, use `@stable-name` and assign a slot when relevant.
- Keep character identity, product geometry, and brand constraints explicit.
