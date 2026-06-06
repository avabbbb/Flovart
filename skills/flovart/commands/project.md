# Project Commands

Project commands provide a LibTV-style local project context for Flovart. The active project is written to `.flovart/project.json` as `projectUuid`.

## project

Show the active project summary.

```bash
npm run flovart:cli -- project --json
```

## project create

Create a local project context and use it by default.

```bash
npm run flovart:cli -- project create --name "Launch Film" --json
npm run flovart:cli -- project.create --name "Launch Film" --json
```

Options:

- `--name`, `-n`: display name.
- `--project-uuid`: explicit project UUID.
- `--use false`: create without switching active context.

## project list

```bash
npm run flovart:cli -- project list --json
npm run flovart:cli -- project.list --json
```

## project use

Switch active context.

```bash
npm run flovart:cli -- project use <projectUuid> --json
npm run flovart:cli -- project.use --project-uuid <projectUuid> --json
```

If the UUID is not known locally, Flovart creates a lightweight local record so imported or shared IDs can still be used.

## project unuse

Clear active project and group context.

```bash
npm run flovart:cli -- project unuse --json
```
