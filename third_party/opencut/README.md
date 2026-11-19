# OpenCut classic (MIT) — attribution

Parts of the Cut editor are adapted from **OpenCut classic**
(https://github.com/OpenCut-app/opencut-classic, MIT, archived 2026-05-17, v0.3.0).
The original copyright and permission notice is in `LICENSE` next to this file and must be kept.

Adapted files (each carries a header naming its OpenCut source):

| Iris file | OpenCut source | What was taken |
|---|---|---|
| `services/cut/subtitles.ts` | `apps/web/src/subtitles/srt.ts` | SRT block parser (seconds instead of ticks; VTT + writers added) |
| `services/cut/snapping.ts` | `apps/web/src/timeline/snapping/{types,resolve}.ts` | snap-point model and nearest-within-threshold resolver |
| `services/cut/shortcuts.ts` | `apps/web/src/actions/definitions.ts` | action table + default-shortcut map structure (defaults changed to CapCut/剪映) |
| `services/cut/fonts.ts` | `apps/web/src/fonts/google-fonts.ts`, `system-fonts.ts` | lazy Google-Fonts loader and system font list |
| `services/cut/cutStore.ts` | `apps/web/src/timeline/timeline-store.ts`, `core/managers/*` | store split (document + history / playhead / selection / clipboard / snapping) |
| `components/cut/*` | `apps/web/src/{panels,preview,timeline}/components` | editor layout (assets · preview · properties · timeline), CapCut-style |

Not taken: the Rust/wgpu WASM compositor (`opencut-wasm`, ~3.0 MB wasm + GPU device), ffmpeg.wasm paths,
Next.js app shell, auth/DB, background remover, Modal transcription.
