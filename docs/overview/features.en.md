# Features

Flovart is best used as a creative workflow rather than treating each capability in isolation:

## 🎨 Creative Workflow

| Workflow | How You'll Use It |
| -------- | ----------------- |
| **Import references** | Drag characters, scenes, products, or sketches into the canvas as visual anchors for later generation. |
| **@ Reference canvas nodes** | Type `@` in the PromptBar below a node to directly reference images, videos, or text nodes from the canvas as context. |
| **Generate 4 options** | Batch-generate 2/4 directions around the same set of references; quickly compare composition, style, and detail. |
| **A/B compare & local edits** | Use the compare view to pick results, then inpaint, outpaint, remove background, upscale, or apply filters to the selected image. |
| **Save as asset** | Keep satisfying characters, scenes, and props in the asset library; drag them back onto the canvas later to reuse. |
| **Let Agent extend** | External agents can read the canvas, ignite nodes, retry failed tasks, and continue extending shots or videos via CLI / SKILL. |

## ⚡ Core Features

| Feature | Description |
| ------- | ----------- |
| **Canvas / Workflow switch** | One-click bottom-bar toggle between canvas mode ↔ node-flow mode, sharing the same canvas state |
| **Infinite Canvas** | Zoom & pan, brush, shapes, text, arrows, layer management, smart alignment |
| **AI Text-to-Image** | Generate images from prompts; supports Gemini / DALL-E / SDXL and more |
| **AI Image Editing** | Select image + prompt → inpaint, background removal, super-resolution |
| **AI Outpainting** | Pick a direction to auto-extend the image content |
| **AI Text-to-Video** | Veo / Sora text-to-video, supports multiple aspect ratios |
| **AI Agent** | Multi-role agent group chat (creative director, prompt engineer, style master, etc.) that auto-generates images after discussion |
| **Filters / Color** | Real-time brightness, contrast, saturation, hue, blur, retro, and more |
| **Layer Masks** | Non-destructive masking with brush erase/restore |
| **Batch Generation** | Generate 2/4 variants at once and compare to choose |
| **Prompt Polishing** | One-click LLM auto-optimization of prompts |
| **@ References** | Type `@` in the input box to reference canvas elements as reference images |
| **Character Lock** | Lock a character's appearance so later generations stay consistent |
| **Asset Library** | Categorized management of characters/scenes/props, drag into canvas to reuse |
| **Multi-Provider** | Google, OpenAI, DeepSeek, MiniMax, Volcengine, Qwen, and 12+ providers |
| **Third-Party Adaptation** | Continuously adapts OpenAI-compatible relays/aggregation endpoints, with ever-expanding compatibility rules |
| **Credential Auto-Detect** | Paste a service credential to auto-detect the provider + fetch available models |
| **A/B Compare** | Drag a slider to compare two images |
| **Bilingual** | Free switching between 简体中文 / English UI |
| **Light/Dark Theme** | Light / dark theme adaptation, fully supported in the Workflow UI |

## 🔌 Agent Integration

- **CLI Control Plane**: `tools/flovart/cli.js` provides 30+ deterministic commands
- **SKILL.md**: Directly driveable by Claude Code / OpenCode / Codex
- **Command Queue**: Browser polls `.flovart/command-queue.json` to execute generation tasks
- **Key Isolation**: CLI never reads, outputs, or stores API keys

## 🎯 Tech Stack

- **Frontend**: React 19 + TypeScript 5.8 + Vite 6
- **State Management**: Zustand + TanStack Query
- **UI Library**: shadcn/ui + Radix UI
- **Styling**: Tailwind CSS + Framer Motion
- **Desktop**: Tauri 2
- **Browser Extension**: Plasmo Framework

## 📦 Deployment Options

- ✅ **Live Demo** — GitHub Pages
- ✅ **Run Locally** — npm run dev
- ✅ **Docker** — docker-compose one-click deployment
- ✅ **Tauri Desktop** — Windows / macOS / Linux
- 🔜 **Browser Extension** — Chrome / Edge store (coming soon)
