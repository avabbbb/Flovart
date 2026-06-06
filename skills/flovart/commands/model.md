# Model, Prompt, and Preference Commands

These commands help agents prepare prompts and select model IDs. They do not expose provider keys.

## models.list

List agent-facing image/video model IDs routed through browser providers.

```bash
npm run flovart:cli -- models.list --purpose all --json
npm run flovart:cli -- models.list --purpose image --json
npm run flovart:cli -- models.list --purpose video --json
```

Use before choosing a model in `provider.select-model` or `element.update-prompt`.

## preferences.manage

Get, set, reset, or add favorite agent preferences.

```bash
npm run flovart:cli -- preferences.manage --action get --json
npm run flovart:cli -- preferences.manage --action set --style cinematic --aspect-ratio 16:9 --json
npm run flovart:cli -- preferences.manage --action add-favorite --prompt "premium hero product shot..." --json
```

Preferences are local agent hints, not provider credentials.

## prompt.enhance

Enhance a brief image/video prompt deterministically using local preference rules.

```bash
npm run flovart:cli -- prompt.enhance --prompt "headphones on marble plinth" --style product --aspect-ratio 1:1 --mode image --json
npm run flovart:cli -- prompt.enhance --prompt "woman enters office and pauses" --style cinematic --aspect-ratio 9:16 --mode video --json
```

Use this as a helper, then still review the output before generation.

## inspiration.search

Search curated prompt inspirations.

```bash
npm run flovart:cli -- inspiration.search --query product --limit 5 --json
```

## inspiration.get

Get one inspiration by ID.

```bash
npm run flovart:cli -- inspiration.get --id product-hero-luxury --json
```

## batch.plan

Create a deterministic multi-shot image plan from one brief.

```bash
npm run flovart:cli -- batch.plan --prompt "30 second product launch ad for wireless headphones" --count 6 --aspect-ratio 16:9 --json
```

## workflow.plan-video

Create a deterministic multi-shot video workflow graph from one brief.

```bash
npm run flovart:cli -- workflow.plan-video --prompt "60 second vertical micro drama" --count 8 --aspect-ratio 9:16 --duration 8 --image-model flux-schnell --video-model kling-v2 --json
```

Load the returned workflow with `workflow.load` after reviewing it.
