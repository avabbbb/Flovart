# Getting Started

Five deployment options — pick the one that fits you:

## Option 1: Run Locally

```bash
git clone https://github.com/avabbbb/Flovart.git
cd Flovart
npm install
npm run flovart:cli -- start --source --web --open
```

The launcher prepares the WebUI and local Browser Agent together, then opens the main Workflow route `#/app` with a one-time bootstrap handoff. Do not paste `37522` into the address bar and expect Agent binding; the direct URL is only the ordinary WebUI. If no AI service is configured, click "Later" to enter an editable Canvas; click "Add AI service" when you are ready to generate.

In source mode, `37522` is only the preferred port. If it is occupied, Flovart automatically selects an available loopback port and reports the actual URL. For an isolated test run, use `npm run flovart:cli -- start --source --web --web-port=0 --agent-port=0 --no-open --json`.

Do not use `--open` for automated browser acceptance because it delegates to the Windows default browser. Run `npm run test:browser:chrome` instead; it uses Playwright's Chrome for Testing executable, an isolated profile, dynamic ports, and a one-time bootstrap URL, then cleans up the test processes.

> We recommend [Google AI Studio](https://aistudio.google.com/apikey) to get free Gemini credentials.

## Option 2: Use an Agent / CLI / MCP with Workflow

Use the current Skill/CLI integrations for Codex, Claude Code and OpenCode, or the WorkBuddy CLI Connector. An experimental local stdio MCP server shares the existing operations. Check the [Support Matrix](../../SUPPORT_MATRIX.md) for each client's actual certification status; the TeleAgent preparation package is not a verified client integration.

```bash
npm run flovart:cli -- status --json
npm run flovart:cli -- start --open --json  # only when status is not ready
npm run flovart:cli -- workflow.inspect --json
```

Normal work uses status, workflow.inspect, workflow.selection.get, workflow.apply and workflow.node.run. Use ensure for connection setup and command.list/schema for discovery or diagnostics. Check the target and revision before writes, then inspect the result. Deterministic commands do not require a second internal AI.

Start the MCP server from the source checkout:

```bash
node tools/flovart/mcp-server.js
```

Configure that process in a client supporting local stdio, with this repository as its working directory; verify the client's own configuration format and version. The five MCP tools still operate on the bound, visible Browser Workflow. They are not headless native-effect tools. See the [current operation contract](../design/ecosystem/OPERATION_SURFACE.md).

Existing DSH integrations keep their service entry point; other users do not need DSH or a director/Dock setup. Agents and transports must not read, print or store raw Provider keys. Tool access is not approval for paid generation.

The [main design](../design/flovart-native-effects.md) defines future native effects and internal Agent entry points. A working panel or MCP handshake does not certify those capabilities.

## Option 3: Third-Party Service Adaptation

Flovart is continuously advancing **OpenAI-compatible** third-party endpoint adaptation (e.g., relay stations, enterprise intranet gateways). You can select **Custom Provider** in Settings and connect it as follows:

1. **Service address** — Enter your endpoint address (for example, `https://api.example.com/v1`; Flovart normalizes compatible paths automatically).
2. **API Key** — Enter the credential for this AI service.
3. **Model** — Flovart discovers models automatically when the service exposes `/models`; if discovery is unavailable, enter a model manually.
4. **Capability declaration** — Configure capabilities only in Advanced settings when automatic inference is not enough.

> **Note on adaptation**: Third-party compatibility rules are still iterating. You are welcome to help improve the adaptation rules and samples so more model services can integrate reliably.

### Supported Image Response Formats

- Standard `b64_json` (OpenAI native format)
- Full Data URL `data:image/...;base64,...`
- HTTPS remote image URL
- Markdown image links returned by Chat Completions (`![](https://...)`)

## Option 4: Docker Local Integration

```bash
git clone https://github.com/avabbbb/Flovart.git
cd Flovart
docker compose up --build -d
```

Visit http://localhost:1635.

The current Compose stack is for local Web, Hub, Enterprise, and PostgreSQL integration only. Static production assets, security settings, and deployment have not completed release acceptance and must not be presented as production-ready.

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

The store-installation, permission, and Desktop-pairing guide has not been published yet; use the developer-mode steps above for current testing.
