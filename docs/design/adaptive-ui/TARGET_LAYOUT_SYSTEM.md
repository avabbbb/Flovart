# Flovart Adaptive UI System — Target Layout System

```text
viewport / host panel
└── AdaptiveShell (100dvh, min-width: 0, min-height: 0)
    ├── navigation / topbar (media-query composition)
    └── active surface (minmax(0, 1fr))
        ├── page composition (grid/flex, media queries)
        └── container-aware components (cards, forms, inspectors)
```

## Tokens

The global adaptive stylesheet owns:

- `--layout-xs/sm/md/lg/xl`: content-space buckets, not device brands;
- `--sidebar-rail`, `--sidebar-expanded`;
- `--panel-min`, `--panel-preferred`, `--panel-max`;
- `--space-*`, control heights and safe-area insets;
- `--app-height` (`100vh` fallback followed by `100dvh`).

## Composition rules

- Wide: keep useful parallel panes when the container can support them.
- Medium: collapse secondary panes to rail/drawer; preserve state and focus.
- Compact: use master-detail, bottom sheet or full overlay. Every primary action remains reachable at 320 CSS px.
- Canvas keeps internal pan/zoom. Its toolbar, PromptBar, sidebar and inspector own their own wrapping/scroll.
- Reusable components set `container-type: inline-size`; viewport media queries only choose shell/navigation composition.
- Every flex/grid child that can shrink sets `min-width: 0; min-height: 0`.
- A surface has one intentional scroll owner. Body scroll is disabled by the shell while panel content scrolls locally.

## State and performance

- CSS performs visual reflow. JS media queries are allowed only for behavior transitions such as drawer mode and are subscribed through `matchMedia`, never a per-pixel `resize` state.
- Resize does not trigger host discovery, provider status, model fetch, workflow save or agent scans.
- User-defined panel widths are validated and clamped by the drawer; invalid/legacy values fall back to token defaults.
