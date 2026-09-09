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

## Option 2: Direct the Production Crew via an External Agent / CLI

The current external-director path is Codex CLI/Browser, Claude Code, and OpenCode CLI. They use the same local CLI through the Operation Skill. DeepSeek Harness keeps an explicit Plugin/Profile projection; CodeBuddy Code and Pi are compatible through the stable contract. WorkBuddy is a separate mainstream office AI workspace, not CodeBuddy Code, and is outside the current Director Binding. Flovart's formal Coding Agent surface is Skill + CLI; users do not need to configure MCP, browser scraping, or a file queue.

```bash
npm run flovart:cli -- status --json
npm run flovart:cli -- start --open --json  # only when status is not ready
npm run flovart:cli -- workflow.inspect --json
```

### How it Works

- **The external harness is the director**: it owns the canonical conversation, overall plan, and cross-task scheduling; closing Flovart must not terminate it.
- **Workspace Operator is the only built-in execution agent**: it calls typed, reversible tools only inside a bounded intent. Production Crew is merely the group name for the Operator, Runtime, workers, and tools—not another agent.
- **Stable Agent surface**: normal work uses only `status`, `workflow.inspect`, `workflow.selection.get`, `workflow.apply`, and `workflow.node.run`; read `command.list` / `command.schema` only for bootstrap, compatibility diagnosis, or debugging.
- **One visible-Workflow authority**: confirm `status` and the target Workflow are ready, then verify every mutation with `workflow.inspect`. All writes go through the current Browser Workflow authority.
- **Secret boundary**: Provider secrets stay in Flovart's controlled boundary. The CLI and external harness never read, print, or store raw secrets.

### Example Commands

```bash
npm run flovart:cli -- workflow.inspect --json
```

External agents use `workflow.apply` or `workflow.node.run` for writes and then re-read `workflow.inspect`. The command registry is readable offline; visible Workflow operations require Flovart Desktop to be running and the target Workflow to be open. See the [Agent architecture package](../design/agent/README.md) for the full boundary.

The target DeepSeek Harness experience installs a dedicated Flovart Profile/Plugin into the Harness shell. A fixed Flovart Dock opens the complete Workflow, Table, and Agent Production Control surface in the central workspace; lightweight overlays handle approvals/status/artifacts, the right-side Agent Bridge manages connections and single-director handoff, and a standalone Flovart window remains available. The Host Plugin still derives and executes model tools from the CLI registry; its Client Plugin uses a scoped local channel only for UI, events, and recovery. This Profile is still a design/migration target, so the current path remains Operation Skill + CLI + the standalone Flovart workspace.

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
