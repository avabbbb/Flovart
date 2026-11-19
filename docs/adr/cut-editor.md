# ADR: Cut tab video editor engine

- Status: accepted
- Date: 2026-11-20
- Scope: `components/cut/`, `services/cut/`, `styles/cut.css`, `third_party/opencut/`

## Context

The middle **Cut** tab (internal view id `reverse`) needs a lightweight in-browser video editor:
multi-track timeline (video, image, audio, text), trim/split/move, per-clip volume, preview with
scrubbing, MP4 (H.264/AAC) export, and export back onto the canvas. Constraints: TypeScript,
mature and maintained, small memory footprint (stream frames, never decode a whole file into RAM),
license compatible with this repo's **MIT** license (no GPL/AGPL, no non-commercial terms), and
lazy-loaded so the main bundle doesn't grow.

## Options considered (checked 2026-11-20 on GitHub / npm)

| Candidate | License | Stars | Latest | Engine / memory model | Verdict |
|---|---|---|---|---|---|
| **Mediabunny** (`mediabunny`) | MPL-2.0 (file-level) | ~7.5k | 1.66.1 (2026-11-19), very active | Pure TS, zero runtime deps, tree-shakable. Demux/mux + WebCodecs decode/encode. Reads `Blob` lazily by byte range; `CanvasSink`/`AudioBufferSink` are async iterators with a small canvas pool. | **Chosen** |
| WebAV (`@webav/av-cliper`, `av-canvas`) | MIT | ~2.1k | 1.2.8 (2026-01-10) | WebCodecs, streaming, OPFS. Higher-level (sprites / combinator). | Good fit, but ~10 months without a release and a bigger opinionated surface (mp4box fork, opfs-tools). Runner-up. |
| Diffusion Studio core (`@diffusionstudio/core`) | MPL-2.0 | ~1.3k | 4.0.3 (2025-12) | Built **on top of Mediabunny**; full compositor. | Adds a framework layer we'd only partly use; no commits for a year. |
| omniclip | MIT (npm says ISC) | ~1.5k | npm 1.0.7 (2024-05) | An app, not a library; uses ffmpeg.wasm + fabric + lit; 66 MB unpacked. | Not embeddable. |
| etro | **GPL-3.0** | ~1.2k | 0.14.1 | Canvas/WebAudio compositor. | License incompatible. |
| Remotion | Remotion License (source-available; companies above a size need a paid company license) | ~74k | 4.0.545 | React-driven rendering; browser export via `@remotion/web-renderer` (itself uses Mediabunny). | Not OSI-open; would put the editor behind commercial terms. (The repo already uses Remotion for the separate storyboard preview; we do not extend that.) |
| ffmpeg.wasm (`@ffmpeg/ffmpeg`) | MIT wrapper, core LGPL/GPL builds | ~18k | 0.12.15 | ~30 MB wasm core; inputs and outputs must sit **whole** in the wasm MEMFS (2–4 GB cap); software-only codecs, multi-thread build needs COOP/COEP + SharedArrayBuffer. | Too heavy and the opposite of streaming; several times slower than hardware WebCodecs. Kept only for the existing node tools. |

## Update 2026-11-20: OpenCut classic as the UX base

The user asked for a CapCut/剪映-style editor based on **OpenCut classic**
(github.com/OpenCut-app/opencut-classic, MIT, TypeScript, archived 2026-05-17, v0.3.0; commit `cf5e79e`).
The live `OpenCut-app/OpenCut` repo is a near-empty Rust rewrite, so we don't use it.

What we found: the classic app has 685 TS files (3.1 MB of source) built on Next.js 16, Radix, better-auth, Drizzle,
and an `EditorCore` of 12 singleton managers. All of its time math goes through `opencut-wasm` (a Rust crate:
ticks/`MediaTime`, fps, compositor). Its preview and export compositor is that same wasm built on **wgpu**:
`opencut_wasm_bg.wasm` is **3.04 MB** uncompressed (+108 KB JS glue). It needs a WebGPU or WebGL2 device, and the
textures for every layer live in GPU memory. That is heavy for our "low memory" goal and would add a second
time model next to ours, so we **don't use the wasm compositor**. Preview and export stay on **Canvas2D +
Mediabunny/WebCodecs**: one streaming decoder per visible clip, nothing decoded ahead. ffmpeg.wasm is not
used at all.

Because of that coupling, a file-by-file port wasn't feasible. We port the separable, framework-free pieces
with attribution, and we rebuild the layout and interactions after OpenCut's editor (assets/text/subtitles panel,
preview, properties, multi-track timeline with playhead, snapping, split/trim, drag between tracks, zoom), with
CapCut defaults on top. Ported files are listed in `third_party/opencut/README.md`; the MIT notice is in
`third_party/opencut/LICENSE`. Recordly (AGPL-3.0) was a UX reference only; none of its code was copied.

License note: this repo's `LICENSE` file says MIT (checked 2026-11-20). The coordinator said the project is
AGPL-3.0. Either way MIT and MPL-2.0 inputs are compatible.

## Decision

Use **Mediabunny 1.64.0** plus **`@mediabunny/aac-encoder` 1.64.0** (a WASM AAC fallback, loaded only when the
browser has no native AAC encoder, e.g. Chromium on Linux). Both versions are **already in
`package-lock.json`** as transitive dependencies of `@remotion/*`, so adding them as direct
dependencies installs **no new packages**; we pin the same version to stay deduplicated.

Licensing: MPL-2.0 is weak, **file-level** copyleft. Using the unmodified npm package from MIT code
is fine. Only changes to Mediabunny's own files would have to be published under MPL-2.0. No
GPL/AGPL or non-commercial terms are introduced.

The editor itself (timeline model, compositor, playback, export orchestration, UI) is our own
code. Mediabunny only does container I/O and WebCodecs plumbing.

## Memory model

- `CutPage` is `React.lazy` from `App.tsx`; `CutEditor` (+ Mediabunny) is a separate lazy chunk
  inside it. The storyboard sub-view never loads the editor chunk.
- Sources stay as `Blob`s (IndexedDB-backed for canvas media, `File` for local files). Mediabunny
  reads byte ranges on demand and never copies the file into the JS heap.
- One decode stream per *active* video clip (`CanvasSink`, pool of 3 canvases) is opened when the
  clip enters the playhead and closed when it leaves. Preview decodes straight to preview size
  (≤640×360).
- Audio is mixed in 1 s (preview) or 2 s (export) chunks with `OfflineAudioContext`; there is never
  a full decoded PCM track.
- Thumbnails are 96×54 `ImageBitmap`s in an LRU (160 entries ≈ 3.3 MB max).
- Unmounting the editor (leaving Cut or switching to the storyboard) disposes every `Input`,
  stream, bitmap and the `AudioContext`.
- Export output is an in-memory `BufferTarget` (encoded MP4 only, roughly bitrate × duration).

## Consequences

- Needs WebCodecs (Chrome/Edge 94+, Safari 16.4+, Firefox 130+ for video). Without it, Cut shows a
  clear message and the storyboard still works.
- H.264 encode is required for MP4; if only VP9 is available we fall back to VP9-in-MP4.
- Local-file sources survive reloads only as metadata ("media offline, re-import"); canvas
  sources are restored automatically from canvas storage.

## Feature notes

- **State**: `services/cut/cutStore.ts` is a vanilla Zustand store: per-canvas-project timeline, undo/redo,
  playhead, selection, clipboard and snapping, persisted to `localStorage` under `iris.cut.timeline.v1:<projectId>`.
  The UI and the Agent tools (`iris_cut_*`) both change it only through store actions, so undo covers both.
  It works headlessly (Cut closed): media operations borrow the lazily loaded engine and release it afterwards.
- **Subtitles**: a dedicated subtitle track, a list panel (time ranges, Enter splits at the cursor, Backspace
  at the start merges), inline editing on the timeline, a shared style for all subtitles (font, size, colour,
  stroke, background, position) with a drag box in the preview, and SRT/VTT import and export.
  Auto-captions are not included (they need STT; out of scope for now).
- **Shortcuts**: CapCut defaults (Space, ⌘/Ctrl+B, Q, W, Delete, ⌘Z/⇧⌘Z, ⌘C/V/D, ←/→ frame, ↑/↓ cut point,
  ⌘+/−, N), plus a cheat sheet on `?`.
- **Proxies**: per source (or "Proxy all") at 540p/720p, built by Mediabunny `Conversion`. They're stored in OPFS
  (IndexedDB fallback) and read as disk-backed `File`s. Preview uses the proxy; export always uses the original.
- **Fonts**: lazily loaded web fonts (CJK-first: Noto Sans/Serif SC, LXGW WenKai, ZCOOL, Ma Shan Zheng…),
  common system fonts, and installed fonts through `queryLocalFonts()` where available. Export and snapshots
  await `document.fonts` for every family in use, so preview and export match.
