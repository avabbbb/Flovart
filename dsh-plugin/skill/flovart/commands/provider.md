# Provider Commands

> Compatibility surface: kept for existing scripts and diagnostics. Users add AI services in Flovart Settings; see `references/providers.md`.

Provider keys and model choices live in Flovart Settings in the browser. No
command exposes a key.

## provider.status

List configured services and masked keys. When the local Runtime is offline it
falls back to the local Agent's mirror of browser Settings
(`source: "agent-vault"`).

```bash
npm run flovart:cli -- provider.status --json
```

Use this before any generation request.

## Retired

`provider.begin-setup`, `provider.select-model` and `provider.test` were
removed and return `COMMAND_RETIRED`. Add keys and choose models in Flovart
Settings instead; never ask the user to paste a key into chat.
