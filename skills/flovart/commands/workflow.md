# Workflow Commands

Workflow commands operate on Flovart's node workflow graph. They are separate from ordinary canvas media elements.

## workflow.inspect

Inspect graph nodes, edges, groups, viewport, selected nodes, and run history.

```bash
npm run flovart:cli -- workflow.inspect --json
```

Use before loading or patching a workflow.

## workflow.load

Replace the current workflow graph.

```bash
npm run flovart:cli -- workflow.load --file workflow.json --json
```

The file may contain either a workflow object or:

```json
{
  "workflow": {
    "nodes": [
      { "id": "image_1", "kind": "imageGen", "x": 240, "y": 180, "config": { "label": "Image" } },
      { "id": "video_1", "kind": "videoGen", "x": 680, "y": 180, "config": { "label": "Video" } }
    ],
    "edges": [
      { "id": "edge_1", "fromNode": "image_1", "fromPort": "image", "toNode": "video_1", "toPort": "image" }
    ],
    "groups": [],
    "viewport": { "x": -120, "y": -80, "scale": 0.86 }
  }
}
```

## workflow.update-node

Patch one node config.

```bash
npm run flovart:cli -- workflow.update-node --nodeId image_1 --config-json "{\"label\":\"Unit 01 Keyframe\",\"prompt\":\"cinematic office reveal\"}" --json
```

Use this for minimal repair instead of reloading the whole graph.

## workflow.run

Run the workflow, one node, or downstream nodes. This is browser-backed.

```bash
npm run flovart:cli -- workflow.run --scope workflow --wait --timeout-ms 120000 --json
npm run flovart:cli -- workflow.run --scope node --nodeId image_1 --wait --json
npm run flovart:cli -- workflow.run --scope from-here --nodeId image_1 --wait --json
```

Allowed scopes: `workflow`, `node`, `from-here`.
