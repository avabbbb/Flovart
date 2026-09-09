# Flovart Adaptive UI System — Current Layout Debt

## R0 static baseline

扫描范围：`App.tsx`、`RouterHost.tsx`、`components/`、`styles/`、`hooks/`、`utils/`；排除 `node_modules/`、`dist/`、`artifacts/`。

当前命中（同一文件中的多处命中会重复计数）：

| Debt class | Matches | Representative locations | Decision |
| --- | ---: | --- | --- |
| JS viewport reads | 8 | `hooks/useCompactViewport.ts`, `WorkflowWorkspace.tsx`, `AssetLibraryBrowser.tsx`, `ResponsivePopover.tsx` | layout-only reads migrate to CSS; popover positioning remains bounded behavior |
| JS viewport height reads | 3 | `AssetLibraryBrowser.tsx`, `ResponsivePopover.tsx` | keep only edge-clamp behavior; no page layout state |
| viewport units | 18+ | `styles/index.css`, `styles/home.css`, `styles/dock.css`, table media preview | use `dvh` with fallback; avoid `vw` for structural widths |
| JS grid templates | 4 | `ScriptNodeEditor.tsx`, `WorkflowImageToolDialogs.tsx` | content-specific grids may remain; page composition moves to CSS |
| absolute positioning | 63 | canvas overlays, badges, popovers, drag handles | valid for canvas/overlay; remove structural column positioning |
| fixed utility widths | recurring | Table, AssetAddModal, top menu and settings actions | replace with `minmax()`, `clamp()`, `min()` and container reflow |

## Confirmed P0 debt

1. `WorkflowWorkspace` derives right panel width and min/max from `window.innerWidth`; the same state drives canvas inset.
2. `useCompactViewport()` installs a global `resize` listener for a single layout breakpoint.
3. `TableWorkspace` JSX declares `220px` source rail and `256px` tools column before CSS can reflow them.
4. `AssetAddModal` and several fallback routes use fixed `h-screen`/`w-[...]` assumptions.
5. Existing responsive smoke scripts launch a visible browser and default to port `3000`; this violates the repository’s managed-headless acceptance boundary and makes temp placement implicit.

## What counts as valid fixed size

- icon, divider, touch target, drag handle and media control sizes;
- readable `max-width` for long-form text;
- minimum functional Canvas geometry, provided the surrounding panel collapses to a drawer.

Structural page columns, modal widths without a `min()` fallback, and per-pixel JS resize state are not valid fixed sizes.
