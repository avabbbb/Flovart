# RC6 Resource Lifecycle Evidence

## Browser run

- Target: `http://127.0.0.1:37522/`
- Browser: isolated visible Chromium context
- Scenario: one persisted image node, Workflow → Table → Workflow
- Repetitions: 30
- Console/page errors: 0
- Screenshot: `C:\tmp\flovart-rc6-resource-final.png`

The view owns one object URL while Workflow is mounted. Table intentionally renders the selected source preview and the source-list thumbnail, so its settled ownership is two object URLs. The run observed:

- maximum immediately after switching to Table: 2
- maximum after Table media settled: 2
- maximum after returning to Workflow: 1
- final Workflow count: 1
- no monotonic increase across 30 cycles

The initial transient 1 → 2 transition is asynchronous media loading in the Table view, not an unowned URL. The lifecycle contract is also covered by `workflowResourceResolver.test.ts`, which explicitly revokes materialized URLs and asserts the tracked set returns to zero.

This is a local lifecycle/retention check only; it is not a substitute for OS-level memory profiling.
