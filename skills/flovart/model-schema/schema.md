# Model and Provider Schema Notes

Flovart has two layers of model information:

- Agent-facing helpers in `tools/flovart/agent-kit.js`, exposed through `models.list`, `preferences.manage`, `prompt.enhance`, `batch.plan`, and `workflow.plan-video`.
- Browser/provider runtime in `services/aiGateway.ts`, where real provider keys, capability detection, model fetch, and generation routing happen.

## Capability Buckets

Provider model maps are grouped by:

- `text`
- `image`
- `video`

Agent commands should select the correct bucket before generation:

```bash
npm run flovart:cli -- models.list --purpose image --json
npm run flovart:cli -- provider.select-model --image-model flux-schnell --json
```

## Provider Setup Boundary

The CLI can say whether a capability is configured, but it must not reveal API keys.

Use:

```bash
npm run flovart:cli -- provider.status --json
npm run flovart:cli -- provider.test --purpose both --json
```

If missing, use:

```bash
npm run flovart:cli -- provider.begin-setup --purpose both --json
```

## Aspect Ratios

Common ratios:

- `16:9`
- `9:16`
- `1:1`
- `4:3`
- `3:4`
- `21:9`

Some video providers support fewer ratios. If a generation fails because of ratio support, keep the same prompt and retry only with a supported ratio.

## Prompt Payload

Media elements store generation state with:

- `promptPayload.rawText`
- `promptPayload.resolvedReferences`
- `modelId`
- `status`
- `progress`
- `error`

Use `element.update-prompt` and `element.assign-slot` to patch prompt payloads. Do not edit provider internals directly from an agent workflow.
