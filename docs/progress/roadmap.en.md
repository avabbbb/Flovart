# Roadmap

## Done ✅

- [X] Infinite canvas + basic design tools
- [X] Multi-provider BYOK system (12+ providers)
- [X] AI text-to-image / image-to-image / text-to-video
- [X] Multi-Agent collaborative group chat (with history sub-view + log persistence)
- [X] Filters/color/layer masks
- [X] AI inpainting / outpainting
- [X] Usage monitoring + batch key management
- [X] Browser extension MVP (v1.2.0)
- [X] Docker deployment
- [X] Tauri 2 desktop app (Win / macOS / Linux)
- [X] Live demo (GitHub Pages)
- [X] Full compatibility with third-party API aggregation endpoints (auto baseUrl trimming, /chat/completions fallback, multi-image format parsing)
- [X] SSE streaming reverse-prompt from images + cancellation
- [X] App.tsx modular refactor (hooks extracted: `useCanvasInteraction` / `useGeneration` / `useApiKeys` / `useToast`)
- [X] Agent-Native CLI (`tools/flovart/cli.js`, 30+ deterministic commands)
- [X] CLI tool bridge (`tools/flovart/cli.js`) + SKILL.md (directly driven by Claude Code / OpenCode / Codex)
- [X] Layer drag-and-drop reordering + real-time drop indicator
- [X] Double-click to focus layer / triple-click empty space to fit view
- [X] Tactile Shell AC visual language (tab bar / layer cards / dialogs / footer unified)
- [X] Compact footer (4 chips: Terms / Privacy / Theme / Language switch)
- [X] **Canvas ↔ Workflow dual-workspace switching** (bottom-bar toggle + independent footer UI)
- [X] **Workflow light/dark theme adaptation** (light background in day mode + dark background in dark mode)

## In Progress 🚧

- [ ] Chrome / Edge store listing
- [ ] Encrypted credential storage on the extension + cross-device sync
- [ ] Tauri auto-update channel (Updater plugin integrated, awaiting a signed test build)
- [ ] Node-flow visual editor iteration (multi-select / collapse / template import)
- [ ] Expanded third-party endpoint adaptation rules (relays / enterprise intranet gateways / custom auth)

## Planned 📝

- [ ] **LangGraph.js agent orchestration** — Replace the runtime behind the node flow with LangGraph, supporting custom Skills (GPTs-like)
- [ ] **One-click AI short-drama pipeline** — Brief → Storyboard → shot breakdown → final video
- [ ] **Multi-board / multi-page** — Share the same canvas collection across workspaces
- [ ] **Real-time collaboration (CRDT)** — Multiple people editing the same canvas, with cursor / selection sync
- [ ] **Canvas performance optimization** — Rendering optimization for scenarios with >500 elements
- [ ] **Plugin marketplace** — Providers / nodes / templates can be packaged and distributed
- [ ] **Mobile adaptation** — Touch gestures + simplified Toolbar
- [ ] **Desktop OS integration** — System tray / global shortcuts / file drag-in
