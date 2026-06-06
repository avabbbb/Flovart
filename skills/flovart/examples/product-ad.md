# Example: Product Ad

Use when the user provides a product image and asks for a product ad or style replication.

## Steps

1. Inspect state:

```bash
npm run flovart:cli -- status --json
npm run flovart:cli -- provider.status --json
npm run flovart:cli -- canvas.inspect --json
```

2. Upload references:

```bash
npm run flovart:cli -- canvas.upload-image --path "C:/absolute/product.png" --name "product-ref" --x 120 --y 160 --json
npm run flovart:cli -- canvas.upload-video --path "C:/absolute/reference.mp4" --name "style-reference-video" --x 120 --y 420 --json
```

3. Create planning text only if the user wants the plan visible on canvas:

```bash
npm run flovart:cli -- element.create --type text --name "ad-shot-plan" --x 420 --y 120 --width 360 --height 260 --json
```

4. Create keyframe image elements:

```bash
npm run flovart:cli -- element.create --type image --name "unit-01-product-hero" --x 840 --y 120 --width 320 --height 180 --json
npm run flovart:cli -- element.update-prompt --element-id <image-id> --text-prompt "premium product hero keyframe using @product-ref as exact product identity reference, controlled studio lighting, clean reflections" --json
npm run flovart:cli -- element.assign-slot --element-id <image-id> --target-element-id <product-ref-id> --slot-role style_ref --json
```

5. Generate after confirmation:

```bash
npm run flovart:cli -- element.ignite --element-id <image-id> --wait --timeout-ms 120000 --json
```

6. Create video shot:

```bash
npm run flovart:cli -- generate.video --prompt "6 second product reveal. Start on the generated hero keyframe. Slow dolly-in, controlled reflection sweep across the product, preserve exact product geometry from product-ref." --source-image-ids <image-id>,<product-ref-id> --duration 6 --aspect-ratio 16:9 --wait --timeout-ms 300000 --json
```

## Delivery

Return product reference ID, keyframe IDs, video job IDs, output URLs, pending failures, and the smallest retry plan.
