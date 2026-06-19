# Workflow Commands

Workflow projects are separate from Canvas boards. Graph edits work in file-state mode; provider generation requires the Flovart browser tab.

```bash
npm run flovart:cli -- workflow.project.create --title "产品视频" --json
npm run flovart:cli -- workflow.node.create --type text --title "提示词" --x 80 --y 120 --json
npm run flovart:cli -- workflow.node.create-connected --from-node-id <text-id> --type config --title "图片生成" --x 520 --y 120 --json
npm run flovart:cli -- workflow.node.run --node-id <config-id> --wait --json
npm run flovart:cli -- workflow.node.stop --node-id <config-id> --json
```

Use `workflow.inspect` to read a media-redacted snapshot. The canonical schemas and MCP-safe aliases come from:

```bash
npm run flovart:cli -- command.schema --command workflow.node.create --json
npm run flovart:cli -- command.schema --command flovart_workflow_node_create --json
```

Node types are `image`, `text`, `video`, `audio`, and `config`. `workflow.node.create-connected` creates the node and its incoming connection atomically. `workflow.node.run` and `workflow.node.stop` require an open Flovart browser because they use the current browser provider runtime.

Available command groups: `workflow.project.*`, `workflow.inspect`, `workflow.node.*`, `workflow.connect`, `workflow.disconnect`, `workflow.select`, and `workflow.viewport.set`. Agent and MCP mutations always require browser confirmation; inspection output redacts media payloads, storage keys, secrets, and local paths.
