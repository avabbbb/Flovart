---
name: vox-director
description: Compile a topic, brief, article, or research artifact into a provider-neutral Flovart ProductionSpec for a VOX-inspired editorial paper-collage explainer. Use for torn-paper collage videos, motion-collage explainers, narrated editorial shorts, scrapbook-style ads, or any request that needs an image-first collage workflow with style bake-off, wide/detail shot cadence, stable typography, keyframe review, narration, music, captions, and delivery verification.
---

# VOX Skill

Turn one topic into a concise editorial paper-collage ProductionSpec. Direct the film; let Flovart own credentials, Provider routing, tasks, budgets, Artifacts, rendering, and Workflow Projection.

## Non-negotiable boundary

- Never read or request an API Key.
- Never call a Provider endpoint or hard-code a Provider/model route.
- Never submit, poll, retry, download, or render outside Flovart Runtime.
- Request only the capabilities declared in `flovart.skill.yaml`.
- Keep style-specific fields under `extensions.community.vox-director`.

## Prepare

1. Read `references/creative-direction.md` before drafting prompts or shots.
2. Inspect the Flovart command registry and the `production.dry-run` schema.
3. If the topic depends on current discourse, collect a provenance-preserving research artifact through Flovart before writing the story.
4. Use `examples/production-spec.json` as the structural example, not as reusable story content.

## Compile the ProductionSpec

1. Choose one narrative arc that fits the topic.
2. Draft a hook that lands within three seconds.
3. For a 30-second film, create 6–8 shots arranged as wide/detail pairs; keep every shot at or below seven seconds.
4. Propose three or four topic-appropriate themes (default to three) and mark one recommendation. Do not pretend the recommendation is the final approved style.
5. Ask the user to approve the beat map and the paid 3–4 image style bake-off before any Provider submission.
6. Lock the approved collage language in `extensions.community.vox-director.look`.
7. Give every shot a flat-safe camera move and scene-specific element motion. Do not repeat the same camera move on adjacent shots.
8. Add spec, style-reference, keyframe-review, and OCR gates.
9. Specify one narrator profile plus instrumental editorial music ducked under narration.
10. Request image generation before image-to-video motion. Treat weak keyframes as a re-draft problem, not a motion problem.

## Validate and project

Run the repository quality gate during this bundled example:

```bash
node tools/flovart/vox-director-quality.js --spec <production-spec.json> --json
```

Require a passing score before compilation. In the built-in PI Agent, first materialize the Brief, shots, prompts, references, and connections on the user's visible Workflow. Re-read `flovart_workflow_inspect`, then call `flovart_production_dry_run` with the current project, Director identity, ProductionSpec, stable idempotency key, and `draftBinding: { draftVersion, sourceNodeIds }` from that exact inspection. The browser binds object versions, ChangeSets, and a redacted snapshot hash before Runtime freezes the Revision. Never open a CLI or create a second hidden canvas as an alternate authoring path.

Wait for the returned Task, inspect `flovart_production_status`, and verify the matching `flovart_workflow_projection_get` result on the user's current visible Workflow. After the user confirms Route Plan and Run Budget, `flovart_production_run` may create the 3–4 same-shot style bake-off Artifacts. Keep keyframes waiting at `style-reference`; show those Artifacts on Workflow and ask the user which `style:bakeoff:<theme>` Stage to lock. Approve that gate only with the chosen `approvedStageKey`. The Runtime must pass that exact Artifact into every keyframe image-to-image request.

Keep motion waiting until the user has reviewed the keyframe sheet and the OCR gate has passed. Approve `keyframe-review` and `ocr` explicitly, then let the same ProductionRun continue. Do not claim a finished film while Route Plan, Run Budget, required capabilities, approvals, Runtime Projection, or Artifact attachment remain blocked.

## Revise

- Revise narrative, prompts, references, duration, narration, or gates through a new ProductionSpec Revision once that command is available.
- Treat node position, size, lock, and viewport as layout only.
- Re-run only the smallest invalidated stage when Runtime supports stage retry.
- Preserve prior Takes and their provenance.

## Deliver

Report the exact Director version, ProductionSpec/Run/Stage identifiers, unresolved blockers, approval state, quoted versus confirmed cost, Artifact identifiers, and verification result.
