# Node Commands

`node` is the LibTV-style canvas operation layer. It maps onto Flovart canvas elements and media generation state.

## node create

```bash
npm run flovart:cli -- node create -t image -n "unit-01-keyframe" -s prompt="cinematic office reveal" --json
npm run flovart:cli -- node.create --type video --name "unit-01-video" -s prompt="slow dolly in" --run --json
```

Options:

- `-t`, `--type`: `image`, `video`, or `text`.
- `-n`, `--name`: node name.
- `-s key=value`: generation parameter. Repeatable. Common keys: `prompt`, `model`.
- `-u key=value`: canvas data update. Repeatable. Common keys: `x`, `y`, `width`, `height`, `text`.
- `--run`: immediately queue media generation.

## node list

```bash
npm run flovart:cli -- node list --json
npm run flovart:cli -- node.list --type image --json
```

By default, the active project/group context filters nodes. Use `--all` to ignore active context.

## node update

```bash
npm run flovart:cli -- node update <nodeId> -s prompt="clearer prompt" -s model=flux-schnell -u x=240 -u y=320 --json
```

`-s` writes generation state. `-u` writes canvas element fields.

For text content:

```bash
npm run flovart:cli -- node update <nodeId> -u content="Scene notes..." --json
```

## node run

```bash
npm run flovart:cli -- node run <nodeId> --json
```

Queues generation for image/video nodes. Without browser provider setup, shadow runtime records a queued job.

## node delete

```bash
npm run flovart:cli -- node delete <nodeId> --json
```
