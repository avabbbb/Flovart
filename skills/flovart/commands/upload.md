# Upload Command

Upload reads a local file and adds it to the active Flovart canvas context.

```bash
npm run flovart:cli -- upload --path "C:/absolute/ref.png" --name "character-a-ref" --json
npm run flovart:cli -- upload "C:/absolute/ref.mp4" --name "rhythm-reference" --json
```

Options:

- `--path`, positional arg: file path.
- `--name`, `-n`: canvas element name.
- `--type`, `-t`: optional `image` or `video`; if omitted, Flovart infers from file extension.
- `--x`, `--y`, `--width`, `--height`: initial placement.

Supported media extensions are defined in `tools/flovart/agent-kit.js`.

The command returns the created element, file path, and inferred media type. It never reads or emits API keys.
