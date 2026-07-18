# Model, prompt, and preference commands

Use these registered helpers without exposing provider keys:

```bash
npm run flovart:cli -- models.list --purpose all --json
npm run flovart:cli -- model.search --type video --query reference --json
npm run flovart:cli -- provider.select-model --image-model flovart:gpt-image-2 --video-model flovart:seedance-2 --json
npm run flovart:cli -- preferences.manage --action get --json
npm run flovart:cli -- prompt.enhance --prompt "headphones on marble plinth" --style product --aspect-ratio 1:1 --mode image --json
npm run flovart:cli -- inspiration.search --query product --limit 5 --json
npm run flovart:cli -- batch.plan --prompt "30 second product launch ad" --count 6 --aspect-ratio 16:9 --json
```

Product Model IDs are stable user-facing identities. Provider Route IDs are execution routes. Select Product Models through `provider.select-model`; do not pass guessed upstream model IDs.

The removed `workflow.plan-video` and Element prompt commands are not available. Build graphs with registered `workflow.*` commands.
