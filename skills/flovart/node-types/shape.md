# Node Type: shape

Shape elements are usually created by the UI. The CLI can inspect and patch existing shape fields through `canvas.update-element`, but `element.create` currently supports only `image`, `video`, and `text`.

## Inspect

```bash
npm run flovart:cli -- canvas.inspect --json
```

## Patch Existing Shape

```bash
npm run flovart:cli -- canvas.update-element --id <shape-id> --updates-json "{\"x\":120,\"y\":120,\"width\":360,\"height\":220}" --json
```

Use shape patches sparingly. For agent-generated project structure, prefer stable element names and coordinates over decorative shapes.
