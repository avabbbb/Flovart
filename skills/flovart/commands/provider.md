# Provider Commands

> Compatibility surface: these browser bridge commands remain for existing scripts and diagnostics. Normal users configure an AI service in the Flovart Settings page.

Provider keys and model preferences stay in the Flovart browser UI, which is the single source of truth. Provider commands use the browser bridge and must never expose keys. Keep the Flovart browser tab open while running them.

## provider.status

Inspect the browser UI's configured capabilities and selected model IDs. The CLI waits for the browser result by default.

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
npm run flovart:cli -- provider.select-model --image-model flovart:gpt-image-2 --video-model flovart:seedance-2 --text-model gemini-3-flash-preview --json
```

This changes the same browser-local model preference used by Flovart generation. It does not validate key access by itself.

## provider.test

Check browser provider readiness for a purpose. The CLI waits for the browser result by default.

```bash
npm run flovart:cli -- provider.test --purpose both --json
```

If it fails, use `provider.begin-setup` rather than asking the user to paste secrets into chat.
