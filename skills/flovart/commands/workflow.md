# Workflow commands

Workflow is the current automated generation workspace. Table has no registered CLI commands yet.

Discover the live surface before acting:

```bash
npm run flovart:cli -- command.list --json
npm run flovart:cli -- command.schema --command workflow.node.create --json
```

Typical graph operations:

```bash
npm run flovart:cli -- workflow.project.list --json
npm run flovart:cli -- workflow.project.create --title "产品视频" --json
npm run flovart:cli -- workflow.project.use --project-id <project-id> --json
npm run flovart:cli -- workflow.inspect --json
npm run flovart:cli -- workflow.node.create --type text --title "创作 Brief" --x 80 --y 120 --json
npm run flovart:cli -- workflow.node.create-connected --from-node-id <text-id> --type config --title "图片生成" --x 520 --y 120 --json
npm run flovart:cli -- workflow.node.run --node-id <config-id> --json
npm run flovart:cli -- workflow.node.stop --node-id <config-id> --json
```

Registered groups currently include `workflow.project.*`, `workflow.inspect`, `workflow.node.*`, `workflow.connect`, `workflow.disconnect`, `workflow.select`, and `workflow.viewport.set`.

Node types are `image`, `text`, `video`, `audio`, and `config`. Read returned IDs directly, then use `workflow.inspect` to verify the redacted graph. Never use removed `canvas.*` or `element.*` commands.
