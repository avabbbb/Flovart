# Release Candidate Host and Browser Chaos Evidence

## Real visible-browser tracer bullet

`C:\tmp\playwright-test-rc12-host-chaos.js` was run through the Playwright
skill against the source WebUI at `127.0.0.1:37522` and a real local Agent at
`127.0.0.1:17373`. The test used a fresh Agent process and an isolated copy of
the connection configuration; no token is recorded here.

The second browser tab intentionally omitted the launcher-only automatic
Writer claim. The observed result was:

```text
2 clients connected
first tab remained Active Writer after second tab opened
first tab close -> visible recovery CTA
CLI inspect while closed -> WORKSPACE_UNAVAILABLE
re-open CTA -> Writer restored and inspect succeeded
wrong project -> WORKSPACE_COMMAND_FAILED
  message: Workflow Browser binding 不匹配：rc12-not-active-project
Claude Code activation -> inspect succeeded
old Codex caller -> AGENT_WRITER_INACTIVE
active project remained unchanged
browser console/page/request errors -> 0
fixture cleanup -> passed
```

The `WORKSPACE_COMMAND_FAILED` wrapper is the stable Workspace Adapter error
for a browser binding mismatch; the inner message preserves the actionable
binding failure instead of routing the operation to another project.

## Existing restart and refresh evidence

- `C:\tmp\flovart-start-open-recovery-20260829.json` records a real
  `flovart start --open --json` recovery after the Agent restart, with WebUI,
  Agent, Browser binding, follow-up inspect/selection, and no raw token in
  the result.
- `C:\tmp\flovart-video-refresh-recovery-20260830.png` is the visible-browser
  async-video refresh evidence. The companion Fake Provider integration test
  proves that resuming a persisted task polls the existing task and does not
  submit a second create request.
- `tests/workflowAgentSession.test.js` covers stale Browser close/reconnect,
  multi-tab Writer locking, project binding, explicit Host switching, and the
  no Browser-to-Native fallback invariant.

## Verification

```text
npx vitest run tests/workflowAgentSession.test.js tests/agentConnectionBootstrap.test.ts tests/agentHostProjection.test.ts tests/flovartBootstrapCoordinator.test.js tests/flovartLocalAgent.test.js --reporter=dot
```

The real tracer bullet and these focused session/bootstrap suites are the
current RC12 evidence. Runtime-kill chaos beyond the existing startup/Agent
restart evidence remains a follow-up if the desktop Runtime is available in a
future release environment.

## Architecture result

- Browser Writer ownership is explicit; an ordinary second tab does not
  silently take over.
- A closed Browser surface fails explicitly and offers a product recovery CTA.
- Host activation is separate from Browser project binding.
- Host switching revokes the previous caller without changing the project.
- Native Workspace is not used as a Browser fallback.

