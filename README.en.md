<p align="center">
  <img src="pic/LOGO.png" alt="Flovart Logo" width="200" />
</p>

<h1 align="center">Flovart</h1>

<p align="center">
  <strong>Open-source Lovart — bring your own key, plug in every model, turn the canvas into an Agent runtime</strong>
</p>

<p align="center">
  <a href="https://avabbbb.github.io/Flovart/" target="_blank"><strong>👉 Live Demo</strong></a>
</p>

<p align="center">
  <a href="https://avabbbb.github.io/Flovart/">Live Demo</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-features">Features</a> •
  <a href="#-roadmap">Roadmap</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-AGPL--3.0--only-E8453C" alt="AGPL-3.0-only License" />
  <img src="https://img.shields.io/badge/React-19-E8453C?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-E8453C?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-6-E8453C?logo=vite&logoColor=white" alt="Vite 6" />
</p>

<p align="center">
  <img src="https://count.getloli.com/get/@flovart-readme?theme=rule34" alt="Flovart Popular Counter" />
</p>

<p align="center">
  <a href="./README.en.md">English</a> •
  <a href="./README.md">简体中文</a>
</p>

---

## 📸 Dual Workspace Preview

<table>
  <tr>
    <td width="50%">
      <img src="pic/Canvas.png" alt="Canvas Workspace" />
      <p align="center"><strong>Canvas Workspace</strong> - Infinite canvas + AI creation</p>
    </td>
    <td width="50%">
      <img src="pic/WorkFlow.png" alt="Workflow Workspace" />
      <p align="center"><strong>Workflow Workspace</strong> - Node-based orchestration</p>
    </td>
  </tr>
</table>

---

## What is this?

I wanted a canvas truly built for AI creation —

- **Freer models**: BYOK (bring your own key), with 12+ providers natively integrated — Google / OpenAI / DeepSeek / MiniMax / Volcengine / Qwen and more — plus an OpenAI-compatible relay adapter so you can connect any endpoint yourself.
- **A more thorough workflow**: A dual-workspace architecture of Canvas + Workflow (node flow) with one-click switching. When the node view feels too heavy, collapse it and use it as a helper while you focus on canvas creation.
- **More driveable**: Three deterministic entry points — CLI (`tools/flovart/cli.js`), MCP (`flovart.*`), and SKILL.md (directly callable by Claude Code / OpenCode / Codex). Every media element on the canvas is exposed as a command. External agents handle planning; Flovart handles execution.
- **A nicer frontend**: Animal Crossing-style Tactile Shell visual language, infinite canvas, `@` layer references, double-click to focus / triple-click to fit, bilingual + light/dark adaptive themes.

Four deployment forms to choose from: live demo, Tauri desktop app, Chrome/Edge browser extension, and Docker self-hosting.

If you share the same wish, pull requests are welcome.

## Special Thanks

**[@labiaaaaaaaaa](https://github.com/labiaaaaaaaaa)** — Drove core fixes for third-party service adaptation, helping Flovart continuously improve integration rules for aggregation gateways and compatible endpoints.

---

## 🚀 Getting Started

Five ways — pick the one that fits you:

### Option 1: Run Locally

```bash
git clone https://github.com/avabbbb/Flovart.git
cd Flovart
npm install
npm run dev
```

Open http://localhost:3217 and enter your service credentials in Settings.

> We recommend [Google AI Studio](https://aistudio.google.com/apikey) to get free Gemini credentials.

### Option 2: Drive the Canvas via Agent / CLI

Flovart provides a local agent-native CLI control plane for external agents or shell scripts such as OpenCode, Claude Code, Codex, Cursor, Windsurf, and Roo to operate the canvas. The main path no longer depends on MCP, nor does it require a Chrome DevTools Protocol port.

```bash
npm run dev
npm run flovart:cli -- status --json
npm run flovart:cli -- canvas.inspect --json
```

How it works:

- **Local data commands**: `canvas.inspect`, `canvas.add-image`, `workflow.load`, `provider.select-model`, etc., read and write the local file-state runtime directly.
- **Browser execution commands**: `generate.image`, `generate.video`, `element.ignite`, `workflow.run`, etc., are written to `.flovart/command-queue.json` and polled & executed by an open Flovart browser tab via the Vite dev server.
- **Unified command registry**: All CLI commands are still defined in `tools/flovart/core.js`. External agents only plan; Flovart only executes deterministic commands.
- **Key security**: API keys are only entered and used in the Flovart browser UI. The CLI never reads, outputs, or stores keys.

Examples:

```bash
npm run flovart:cli -- canvas.add-image --href "data:image/png;base64,..." --name "Reference" --json
npm run flovart:cli -- generate.image --prompt "cinematic product poster" --json
```

### Option 3: Third-Party Service Adaptation (ongoing)

Flovart is continuously advancing **OpenAI-compatible** third-party endpoint adaptation (e.g., relay stations, enterprise intranet gateways). You can select **Custom Provider** in Settings and connect it as follows:

1. **Base URL** — Enter your endpoint address (e.g., `https://api.example.com/v1/chat/completions`; Flovart trims it to `/v1` automatically).
2. **Service credentials** — Enter your access credentials.
3. **Model name** — Select or manually enter a model (e.g., `gemini-2.5-flash-preview-image-generation`, `gpt-image-1`).
4. **Capability declaration** — Check the capabilities your credential supports (image / video / text); custom models are categorized into the dropdown accordingly.

> **Note on adaptation**: Third-party compatibility rules are still iterating. You are welcome to help improve the adaptation rules and samples so more model services can integrate reliably.

**Supported image response formats**:

- Standard `b64_json` (OpenAI native format)
- Full Data URL `data:image/...;base64,...`
- HTTPS remote image URL
- Markdown image links returned by Chat Completions (`![](https://...)`)

### Option 4: Docker

```bash
git clone https://github.com/avabbbb/Flovart.git
cd Flovart
docker-compose up -d
```

Visit http://localhost:3217.

### Option 5: Browser Extension

> 🔜 **Preparing for the Chrome / Edge store — Coming Soon.**
>
> For now, load it via developer mode:

```bash
npm run ext:build
```

1. Open `chrome://extensions/` or `edge://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select the `dist-extension/` directory

---

## 🎯 Features

| Feature                 | Description                                                                       |
| ----------------------- | --------------------------------------------------------------------------------- |
| **Canvas / Workflow switch** | One-click bottom-bar toggle between canvas mode ↔ node-flow mode, sharing the same canvas state |
| **Infinite Canvas**     | Zoom & pan, brush, shapes, text, arrows, layer management, smart alignment        |
| **AI Text-to-Image**    | Generate images from prompts; supports Gemini / DALL-E / SDXL and more            |
| **AI Image Editing**    | Select image + prompt → inpaint, background removal, super-resolution             |
| **AI Outpainting**      | Pick a direction to auto-extend the image content                                 |
| **AI Text-to-Video**    | Veo / Sora text-to-video, supports multiple aspect ratios                         |
| **AI Agent**            | Multi-role agent group chat (creative director, prompt engineer, style master, etc.) that auto-generates images after discussion |
| **Filters / Color**     | Real-time brightness, contrast, saturation, hue, blur, retro, and more            |
| **Layer Masks**         | Non-destructive masking with brush erase/restore                                  |
| **Batch Generation**    | Generate 2/4 variants at once and compare to choose                               |
| **Prompt Polishing**    | One-click LLM auto-optimization of prompts                                         |
| **@ References**        | Type `@` in the input box to reference canvas elements as reference images        |
| **Character Lock**      | Lock a character's appearance so later generations stay consistent                |
| **Asset Library**       | Categorized management of characters/scenes/props, drag into canvas to reuse      |
| **Multi-Provider**      | Google, OpenAI, DeepSeek, MiniMax, Volcengine, Qwen, and 12+ providers            |
| **Third-Party Adaptation** | Continuously adapts OpenAI-compatible relays/aggregation endpoints, with ever-expanding compatibility rules |
| **Credential Auto-Detect** | Paste a service credential to auto-detect the provider + fetch available models |
| **A/B Compare**         | Drag a slider to compare two images                                               |
| **Bilingual**           | Free switching between 简体中文 / English UI                                       |
| **Light/Dark Theme**    | Light / dark theme adaptation, fully supported in the Workflow UI                 |

---

## 📋 Roadmap

### Done ✅

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
- [X] MCP tool bridge (`flovart.*`) + SKILL.md (directly driven by Claude Code / OpenCode / Codex)
- [X] Layer drag-and-drop reordering + real-time drop indicator
- [X] Double-click to focus layer / triple-click empty space to fit view
- [X] Tactile Shell AC visual language (tab bar / layer cards / dialogs / footer unified)
- [X] Compact footer (4 chips: Terms / Privacy / Theme / Language switch)
- [X] **Canvas ↔ Workflow dual-workspace switching** (bottom-bar toggle + independent footer UI)
- [X] **Workflow light/dark theme adaptation** (light background in day mode + dark background in dark mode)

### In Progress 🚧

- [ ] Chrome / Edge store listing
- [ ] Encrypted credential storage on the extension + cross-device sync
- [ ] Tauri auto-update channel (Updater plugin integrated, awaiting a signed test build)
- [ ] Node-flow visual editor iteration (multi-select / collapse / template import)
- [ ] Expanded third-party endpoint adaptation rules (relays / enterprise intranet gateways / custom auth)

### Planned 📝

- [ ] **LangGraph.js agent orchestration** — Replace the runtime behind the node flow with LangGraph, supporting custom Skills (GPTs-like)
- [ ] **One-click AI short-drama pipeline** — Brief → Storyboard → shot breakdown → final video
- [ ] **Multi-board / multi-page** — Share the same canvas collection across workspaces
- [ ] **Real-time collaboration (CRDT)** — Multiple people editing the same canvas, with cursor / selection sync
- [ ] **Canvas performance optimization** — Rendering optimization for scenarios with >500 elements
- [ ] **Plugin marketplace** — Providers / nodes / templates can be packaged and distributed
- [ ] **Mobile adaptation** — Touch gestures + simplified Toolbar
- [ ] **Desktop OS integration** — System tray / global shortcuts / file drag-in

---

## 🤝 Contributing

1. Fork this repository
2. Create a branch `git checkout -b feature/xxx`
3. Commit changes `git commit -m 'Add xxx'`
4. Push `git push origin feature/xxx`
5. Open a Pull Request

> [CONTRIBUTING.md](./CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

---

## ⭐ Star

If Flovart helps you, give it a Star ⭐ to show your support!

[![Star History Chart](https://api.star-history.com/svg?repos=avabbbb/Flovart&type=Date)](https://star-history.com/#avabbbb/Flovart&Date)

---

## Disclaimer

### Unofficial Deployment Notice

Flovart's official release channels are limited to:

- **GitHub repository**: [github.com/avabbbb/Flovart](https://github.com/avabbbb/Flovart)
- **Live demo**: [avabbbb.github.io/Flovart](https://avabbbb.github.io/Flovart)
- **Desktop builds**: EXE / DMG / deb / AppImage signed by this repo's Actions

Apart from the addresses above, any third-party public deployment, mirror site, hosting service, modified service, bundled package, or cloud-drive distribution is unofficial and unrelated to the author.

**Do not enter your API key or other sensitive information on unofficial sites.** Third-party deployments may collect, store, or tamper with your credentials, and the author cannot be held responsible for such behavior.

### AI-Generated Content

Flovart is a local-first AI creation tool that calls model services through third-party API keys you configure yourself. All images, videos, and text you generate with this tool are produced by API keys and models under your control. **You are responsible for the compliance, copyright ownership, and legality of the generated content.**

Flovart does not bundle any model service, does not store users' API keys, and makes no intellectual property claims over generated content.

### Scope of Disclaimer

- This software is provided "as is", without any express or implied warranties, including but not limited to merchantability, fitness for a particular purpose, or non-infringement.
- The author is not liable for any direct, indirect, incidental, special, or consequential damages arising from the use of or inability to use this software.
- The pricing, availability, output quality, content moderation, and data-retention policies of third-party API providers are the responsibility of each provider and unrelated to this project.
- The behavior of modified versions, unofficial builds, and third-party forks is outside the scope of this notice.

---

## 📄 License

This project is open-sourced under the [GNU Affero General Public License v3.0 only](./LICENSE).

By using this product you agree to the [Terms of Service](./TERMS_OF_SERVICE.md) and [Privacy Policy](./PRIVACY_POLICY.md).
