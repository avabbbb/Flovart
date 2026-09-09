# Workflow commands

Workflow is the current automated generation workspace. Table has no registered CLI commands yet.

Normal Agent flow starts from readiness and inspect:

```bash
npm run flovart:cli -- ensure --json
npm run flovart:cli -- workflow.inspect --json
```

Use `command.list` / `command.schema` only when a compatibility command is unfamiliar or the Registry contract has changed.

Typical graph operations:

```bash
npm run flovart:cli -- workflow.project.list --json
npm run flovart:cli -- workflow.project.create --title "产品视频" --json
npm run flovart:cli -- workflow.project.use --project-id <project-id> --json
npm run flovart:cli -- workflow.inspect --json
npm run flovart:cli -- workflow.selection.get --json
npm run flovart:cli -- workflow.node.create --type text --title "创作 Brief" --x 80 --y 120 --json
npm run flovart:cli -- workflow.node.create-connected --from-node-id <text-id> --type config --title "图片生成" --x 520 --y 120 --json
npm run flovart:cli -- workflow.node.run --node-id <config-id> --json
npm run flovart:cli -- workflow.node.stop --node-id <config-id> --json
```

The stable Agent surface is `workflow.inspect`, `workflow.selection.get`, `workflow.apply`, and `workflow.node.run` (with `workflow.node.stop` for cancellation). Granular `workflow.node.*`, connection, selection, and viewport commands remain compatibility adapters and route through the same visible Workflow contract.

Node types are `image`, `text`, `video`, `audio`, and `config`. Read returned IDs directly, then use `workflow.inspect` to verify the redacted graph. Never use removed `canvas.*` or `element.*` commands.
