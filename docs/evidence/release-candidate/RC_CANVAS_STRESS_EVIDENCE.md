# Release Candidate Canvas Stress Evidence

## Scope

This run used a visible Chromium session against the Flovart Vite app at `http://127.0.0.1:37522/` with an isolated browser context. The 100/300/500-node graphs were deterministic local fixtures written to the isolated Workflow IndexedDB store, then rendered by the real Workflow UI. Canvas operations were driven through the visible UI handlers; the fixture injection only avoids spending the measurement on manually creating hundreds of nodes.

The captured screenshot is `C:\tmp\flovart-rc5-500-node.png`.

## Load and memory observations

| Fixture | Nodes | Edges | Canvas load to all nodes | JS heap after render |
| --- | ---: | ---: | ---: | ---: |
| Small | 100 | 99 | 1,258 ms | 63.5 MiB |
| Medium | 300 | 299 | 1,565 ms | 115.5 MiB |
| Large | 500 | 499 | 2,365 ms | 134.1 MiB |

The 500-node fixture was reloaded 20 times. Results were:

* median: 2,091 ms
* p95: 3,059 ms
* worst: 3,059 ms
* console/page errors: 0

This is an RC baseline, not a universal performance budget. It is suitable for comparing later changes on the same workstation and browser profile.

## Real browser interaction evidence

The large fixture completed all scripted checks:

* node selection: pass;
* node drag: pass, with persisted position change;
* node connection: pass, with the expected additional edge;
* node deletion: pass;
* undo: pass;
* redo: pass;
* restore after redo: pass;
* canvas pan and zoom gesture: completed;
* 20 reloads after the interaction sequence: pass.

The deterministic Vitest companion also passes a 500-node/499-edge graph invariant and 100 mutation → 100 undo → 100 redo graph round trip. Revision remains monotonic; object-version changes are intentionally excluded from the semantic graph hash.

## Follow-up observation

Text-node body editing correctly captures pointer events for editing, so a naïve click inside the textarea does not also select/drag the node. The layer picker remains the selection path in that case. This is recorded for RC8/RC18 review; the stress verdict above uses image nodes with no editing control so Canvas selection/drag semantics are measured independently.
