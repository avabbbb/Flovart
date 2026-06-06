# Provider Commands

Provider keys stay in the Flovart browser UI. The CLI may inspect readiness and select model IDs, but it must never expose keys.

## provider.status

Inspect configured capabilities and selected model IDs.

```bash
npm run flovart:cli -- provider.status --json
```

Use this before any generation request.

## provider.begin-setup

Open provider setup in the browser UI.

```bash
npm run flovart:cli -- provider.begin-setup --provider google --purpose both --json
npm run flovart:cli -- provider.begin-setup --purpose image --json
```

Arguments:

- `provider`: optional provider ID.
- `purpose`: `image`, `video`, or `both`.

If setup is needed, stop and ask the user to enter credentials in the browser UI.

## provider.select-model

Select model IDs for image, video, and text routing.

```bash
npm run flovart:cli -- provider.select-model --image-model flux-schnell --video-model kling-v2 --text-model gpt-4.1-mini --json
```

This changes local preference/state only. It does not validate key access by itself.

## provider.test

Check provider readiness for a purpose.

```bash
npm run flovart:cli -- provider.test --purpose both --json
```

If it fails, use `provider.begin-setup` rather than asking the user to paste secrets into chat.
