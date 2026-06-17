# Getting Started

Five deployment options — pick the one that fits you:

## Option 1: Run Locally

```bash
git clone https://github.com/avabbbb/Flovart.git
cd Flovart
npm install
npm run dev
```

Open http://localhost:3217 and enter your service credentials in Settings.

> We recommend [Google AI Studio](https://aistudio.google.com/apikey) to get free Gemini credentials.

## Option 2: Drive the Canvas via Agent / CLI

Flovart provides a local agent-native CLI control plane for external agents or shell scripts such as OpenCode, Claude Code, Codex, Cursor, Windsurf, and Roo to operate the canvas. The main path only depends on the CLI and does not require a Chrome DevTools Protocol port.

```bash
npm run dev
npm run flovart:cli -- status --json
npm run flovart:cli -- canvas.inspect --json
```

### How it Works

- **Local data commands**: `canvas.inspect`, `canvas.add-image`, `workflow.load`, `provider.select-model`, etc., read and write the local file-state runtime directly.
- **Browser execution commands**: `generate.image`, `generate.video`, `element.ignite`, `workflow.run`, etc., are written to `.flovart/command-queue.json` and polled & executed by an open Flovart browser tab via the Vite dev server.
- **Unified command registry**: All CLI commands are still defined in `tools/flovart/core.js`. External agents only plan; Flovart only executes deterministic commands.
- **Key security**: API keys are only entered and used in the Flovart browser UI. The CLI never reads, outputs, or stores keys.

### Example Commands

```bash
npm run flovart:cli -- canvas.add-image --href "data:image/png;base64,..." --name "Reference" --json
npm run flovart:cli -- generate.image --prompt "cinematic product poster" --json
```

## Option 3: Third-Party Service Adaptation

Flovart is continuously advancing **OpenAI-compatible** third-party endpoint adaptation (e.g., relay stations, enterprise intranet gateways). You can select **Custom Provider** in Settings and connect it as follows:

1. **Base URL** — Enter your endpoint address (e.g., `https://api.example.com/v1/chat/completions`; Flovart trims it to `/v1` automatically).
2. **Service credentials** — Enter your access credentials.
3. **Model name** — Select or manually enter a model (e.g., `gemini-2.5-flash-preview-image-generation`, `gpt-image-1`).
4. **Capability declaration** — Check the capabilities your credential supports (image / video / text); custom models are categorized into the dropdown accordingly.

> **Note on adaptation**: Third-party compatibility rules are still iterating. You are welcome to help improve the adaptation rules and samples so more model services can integrate reliably.

### Supported Image Response Formats

- Standard `b64_json` (OpenAI native format)
- Full Data URL `data:image/...;base64,...`
- HTTPS remote image URL
- Markdown image links returned by Chat Completions (`![](https://...)`)

## Option 4: Docker Deployment

```bash
git clone https://github.com/avabbbb/Flovart.git
cd Flovart
docker-compose up -d
```

Visit http://localhost:3217.

For more Docker configuration options, see [Docker Deployment Guide](../deployment/docker.en.md).

## Option 5: Browser Extension

> 🔜 **Preparing for the Chrome / Edge store — Coming Soon.**
>
> For now, load it via developer mode:

```bash
npm run ext:build
```

1. Open `chrome://extensions/` or `edge://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select the `dist-extension/` directory

For more extension installation details, see [Browser Extension Guide](../deployment/browser-extension.en.md).
