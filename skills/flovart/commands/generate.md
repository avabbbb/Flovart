# Generation commands

Generation is browser-backed. Keep the Flovart UI open and check readiness first:

```bash
npm run flovart:cli -- provider.status --json
npm run flovart:cli -- provider.test --purpose both --json
```

Always inspect the current schema before submitting:

```bash
npm run flovart:cli -- command.schema --command generate.image --json
npm run flovart:cli -- command.schema --command generate.images-batch --json
npm run flovart:cli -- command.schema --command generate.video --json
```

Examples using only registered arguments:

```bash
npm run flovart:cli -- generate.image --prompt "cinematic product poster, clean hero composition" --aspect-ratio 16:9 --json
npm run flovart:cli -- generate.video --prompt "slow dolly-in, subject turns toward camera" --source-image-ids image1,image2 --duration-sec 8 --aspect-ratio 16:9 --json
npm run flovart:cli -- video.status --job-id <job-id> --json
```

`generate.image` can target a Workflow project or node when the schema exposes `projectId` and `targetNodeId`. `generate.video` accepts typed image, video, or slot references according to the active Product Model and Provider Route.

Do not reuse removed options such as `placeOnCanvas`, `layout`, or generic `wait` unless they reappear in `command.schema`. Retry only the failed job with the smallest prompt or reference change.
