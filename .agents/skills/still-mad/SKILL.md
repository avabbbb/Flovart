---
name: still-mad
description: Turn a song and a set of still images into a 静止系 MAD (still-image music edit) through the Flovart pipeline. Use for beat-synced edits built from illustrations, manga panels, key art, or generated keyframes, where every shot is a still with push, pull, pan, tilt, shake, or impact moves, flash cuts on the downbeat, and short title cards. Not for narrated explainers (use vox-director) or AI image-to-video.
---

# 静止系 MAD

Cut stills to the music. Motion comes from the edit, not from a video model:
every shot is one image moved by a 2D camera (`motion` on the visual clip),
cut on the beat, with flashes and title cards on the accents. Flovart owns
credentials, generation, budgets, artifacts and rendering.

## Boundary

- Never read or request an API key, and never call a Provider directly.
- Use only music and images the user owns or is licensed to use. If the user
  names a commercial song or someone else's artwork, say once that publishing
  it may need permission, then continue with what they supply.
- Do not use image-to-video generation for shots; this genre is stills.
- Every pipeline write carries a stable `--mutation-id` and `--caller`.

## Prepare

1. Read `references/direction.md` (structure, motion vocabulary, pacing).
2. Ask only for what is missing: the music file, its BPM (and first downbeat
   if the track has an intro), target length, aspect ratio, and the images or
   the theme to generate them from.
3. `pipeline.run.start` with the brief and a budget. `asset.import` the music
   and any supplied images from the user's authorized folder; `media.probe`
   the music for its exact duration.

## Plan the edit

1. Split the song into sections (intro, build, drop, break, outro) by time.
2. Lay the cut grid with the beat formula in `references/direction.md`
   (`beatGridCuts`): long holds in the intro, 2-beat cuts in the build,
   1-beat or half-beat cuts on the drop.
3. Give each shot one motion. Never repeat the same move on adjacent shots.
   Put `impact` or `flash: true` only on downbeats and section changes.
4. Write at most one title card per section, 2–8 characters, on the text track.
5. Show the user the shot list (time, image, motion, card) and get approval
   before any paid generation.

## Keyframes

- Supplied art: map each image to its shots; reuse is fine with a different move.
- Generated art: build one image node per keyframe on the user's visible
  Workflow (same style words in every prompt, varied subject and framing), then
  run them with one `workflow.node.run --node-ids` so the user confirms the cost
  once. Rerun only rejected frames. Bring the chosen frames into the run with
  `asset.import`.
- Ask the user to review the keyframe sheet before composing.

## Compose, render, review

1. `composition.patch` version 1: one visual clip per cut (`kind: image`,
   `fit: cover`, `motion`), the music on the audio track (`role: music`,
   `duck: false`), title cards on the text track. See
   `examples/pipeline-spec.json` for the shape.
2. `composition.render --engine remotion --preset draft` (motion renders only
   in Remotion), then `media.frames` around every drop and `media.probe`.
3. `review.submit` with findings pinned to time and clip: cuts off the beat,
   a move that fights the music, an unreadable card, a repeated move. Fix with
   `composition.patch` scoped to that review; lock clips that already work.
4. When a review passes, render `--preset final` and offer `run.archive`.

## Deliver

Report the run id, final version, length, where the file is, and anything left
unresolved (missing BPM, unlicensed material, skipped shots).
