# 静止系 MAD direction

A still-image MAD is an edit, not an animation. The images never move on their
own; the camera, the cut and the flash do the work, and all three follow the
music.

## Structure

| Section | Cut length | Moves | Accents |
| --- | --- | --- | --- |
| Intro | 4–8 beats | slow `push`, `pan-*`, `ease: in-out` | title card, no flash |
| Build | 2 beats | `tilt-*`, `pull`, faster pans | card on the last bar |
| Drop | 1 beat, ½ beat on fills | `impact`, `shake`, `push` with `flash` | flash on every downbeat |
| Break | 4 beats | `none` or very slow `push` | one quiet card |
| Outro | 4–8 beats | `pull` out to the strongest image | final card, fade by holding |

Change the image on every cut in the drop. In the intro and break, one image may
hold across two cuts with two different moves.

## Motion vocabulary

`motion` on a visual clip: `{ type, amount?, ease?, flash? }`.

| type | Feel | Default amount |
| --- | --- | --- |
| `push` | lean in, tension | 0.12 |
| `pull` | release, reveal | 0.12 |
| `pan-left` / `pan-right` | travel across a wide image | 0.16 |
| `tilt-up` / `tilt-down` | reveal a tall image | 0.16 |
| `shake` | hit that decays over the shot | 0.06 |
| `impact` | snap zoom, settle, white flash | 0.12 |
| `none` | hold | 0 |

- `amount` is a share of the frame, 0–0.5. Above 0.25 reads as a zoom effect,
  so keep it for one accent per section.
- `ease`: `linear` for travel, `out` for a hit that settles, `in-out` for slow
  sections.
- The renderer overscales so a pan or shake never shows the frame edge.
- Adjacent shots never share a type. Alternate direction on consecutive pans.

## Beat grid

One beat is `60000 / BPM` ms. Shots start at the first downbeat (`offsetMs`);
anything before it is one intro shot. `beatGridCuts({ bpm, offsetMs, durationMs,
beatsPerShot })` in `services/reverse/stillMotion.ts` returns the cut list;
`beatsPerShot` may be a repeating pattern such as `[2, 1, 1]`.

Worked example: 128 BPM is 468.75 ms a beat. A 2-beat cut is 937.5 ms, which the
grid rounds per cut so the sum stays on the beat.

## Images

- One clear subject per image, readable at a glance, at least the output size.
- Wide images for pans, tall images for tilts, faces and hands for impacts.
- Generated sets keep one style line in every prompt and vary subject, angle
  and distance; avoid text inside the image so title cards stay the only type.

## Title cards

2–8 characters, bold, centered or bottom, on the beat, held for 2–4 beats. One
per section at most. Lyrics belong in captions only if the user asks.

## Review checklist

- Every cut lands within one frame of its beat.
- No two adjacent shots share a move; flashes only on downbeats.
- Cards are readable for at least 1 second and never cover a face.
- The drop changes image every beat; the outro ends on the strongest image.
