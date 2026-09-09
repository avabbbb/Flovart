# Flovart Adaptive UI — Responsive Matrix

## Validation buckets

| Bucket | Widths | Composition expectation |
| --- | --- | --- |
| Compact | 320–479 | single column, sheet/drawer, wrapped actions |
| Small | 480–767 | compact navigation, stacked tools, local overflow only |
| Medium | 768–1023 | icon rail or collapsible context, one primary pane |
| Large | 1024–1439 | fluid multi-pane layout with clamped drawers |
| Wide | 1440+ | full navigation labels and parallel panes |

## Required screenshots

`2560×1440`, `1920×1080`, `1600×900`, `1440×900`, `1366×768`, `1280×720`, `1024×768`, `820×1180`, `768×1024`, `640×900`, `480×800`, `430×932`, `390×844`, `360×800`, `320×800`; short heights `1280×600`, `1024×600`, `768×500`.

## Surface gates

| Surface | 320/390 | 768/1024 | 1440+ | State-preserving resize |
| --- | --- | --- | --- | --- |
| Settings / API | master-detail; URL, Key, Test, Save reachable | narrow nav + detail | two-column detail cards | draft fields and selected section survive |
| Workflow / Canvas | canvas + floating toolbar; inspector sheet | canvas + collapsible sidebar/drawer | sidebar + canvas + inspector | node, viewport, tabs survive |
| Table | stacked source/preview/tools | source rail + stacked tools | source + preview + tools | selected source and result survive |
| Agent | context/conversation tabs | collapsible context | parallel context + conversation | selected context/session survives |
| Agent Link | cards + Advanced disclosure | two-column cards | full diagnostics | input/connection state survives |
| Onboarding / Modal | full-height sheet, local body scroll | bounded dialog | centered dialog | current step and draft survive |

## Acceptance assertions

1. Non-Canvas pages have no document-level horizontal overflow at all matrix widths.
2. Shell bottom reaches the available dynamic viewport; short heights keep primary actions visible.
3. Overlay surfaces stay within the viewport and expose Escape/close controls.
4. Continuous resize `2560 → 1920 → 1440 → 1280 → 1024 → 768 → 600 → 480 → 390 → 320 → 1440` does not reload or issue business requests.
5. 100%, 125%, 150%, 200% and 400% zoom retain Settings/API/Agent/Onboarding function.
6. Light/dark and Chinese/English are checked for long labels, URLs, model IDs and status messages.
