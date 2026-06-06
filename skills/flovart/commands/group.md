# Group Commands

Group commands provide a LibTV-style canvas grouping context. The active group is written to `.flovart/project.json` as `groupNodeKey`.

## group

Show active group context.

```bash
npm run flovart:cli -- group --json
```

## group create

Create and use a group.

```bash
npm run flovart:cli -- group create --name "Unit Videos" --json
npm run flovart:cli -- group.create --name "Unit Videos" --json
```

Options:

- `--name`, `-n`: group display name.
- `--group-node-key`: explicit group key.
- `--project-uuid`: attach to a project other than the active project.
- `--use false`: create without switching active group.

## group list

List groups in the active project.

```bash
npm run flovart:cli -- group list --json
```

## group use

```bash
npm run flovart:cli -- group use <groupNodeKey> --json
npm run flovart:cli -- group.use --group-node-key <groupNodeKey> --json
```

## group unuse

```bash
npm run flovart:cli -- group unuse --json
```

New nodes inherit active `projectUuid` and `groupNodeKey`.
