# Model, prompt, and preference commands

> Compatibility surface: these helpers remain for existing scripts and diagnostics. New Agent work uses the stable five-command surface and the Iris UI for service setup.

Use these registered helpers without exposing provider keys:

```bash
npm run iris:cli -- models.list --purpose all --json
npm run iris:cli -- model.search --type video --query reference --json
npm run iris:cli -- preferences.manage --action get --json
npm run iris:cli -- prompt.enhance --prompt "headphones on marble plinth" --style product --aspect-ratio 1:1 --mode image --json
npm run iris:cli -- inspiration.search --query product --limit 5 --json
npm run iris:cli -- batch.plan --prompt "30 second product launch ad" --count 6 --aspect-ratio 16:9 --json
```

Product Model IDs are stable user-facing identities. Provider Route IDs are execution routes. Product Models are chosen in Iris Settings (the retired provider.select-model command no longer works); do not pass guessed upstream model IDs.

The removed `workflow.plan-video` and Element prompt commands are not available. Build graphs with registered `workflow.*` commands.
