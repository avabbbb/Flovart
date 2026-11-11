# Status and diagnostics

> Compatibility surface: `doctor` and the provider bridge below remain for older setup scripts. Use the stable readiness commands for normal Agent work.

Inspect readiness before mutation:

```bash
npm run flovart:cli -- ensure --json
npm run flovart:cli -- workflow.inspect --json
npm run flovart:cli -- provider.status --json
```

`ensure` owns local service startup, Browser bootstrap, and recovery. Use
`status` only to inspect a reported failure; do not manually construct a URL,
token, or port.

Use `doctor` when the browser bridge, host setup, or Workflow generation surface appears unavailable:

```bash
npm run flovart:cli -- doctor --json
```

When an unfamiliar compatibility command or contract mismatch occurs, read its schema instead of copying old options:

```bash
npm run flovart:cli -- command.schema --command workflow.inspect --json
```

Diagnostics must not expose credentials. The current registry has no Canvas, Element, or Table commands.
