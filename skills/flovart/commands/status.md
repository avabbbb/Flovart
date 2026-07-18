# Status and diagnostics

Inspect the registry and runtime before mutation:

```bash
npm run flovart:cli -- command.list --json
npm run flovart:cli -- status --json
npm run flovart:cli -- provider.status --json
```

Use `doctor` when the browser bridge, host setup, or Workflow generation surface appears unavailable:

```bash
npm run flovart:cli -- doctor --json
```

Read a command schema instead of copying old options:

```bash
npm run flovart:cli -- command.schema --command workflow.inspect --json
```

Diagnostics must not expose credentials. The current registry has no Canvas, Element, or Table commands.
