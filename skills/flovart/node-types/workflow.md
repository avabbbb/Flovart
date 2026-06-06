# Node Type: workflow

Workflow nodes live in the node workflow graph, not directly in the canvas element list.

Inspect workflow state:

```bash
npm run flovart:cli -- workflow.inspect --json
```

Plan a video workflow:

```bash
npm run flovart:cli -- workflow.plan-video --prompt "30 second product ad" --count 6 --aspect-ratio 16:9 --duration 6 --json
```

Load reviewed workflow JSON:

```bash
npm run flovart:cli -- workflow.load --file workflow.json --json
```

Run:

```bash
npm run flovart:cli -- workflow.run --scope workflow --wait --timeout-ms 300000 --json
```

Patch one node instead of replacing the whole graph:

```bash
npm run flovart:cli -- workflow.update-node --nodeId image_1 --config-json "{\"prompt\":\"updated keyframe prompt\"}" --json
```
