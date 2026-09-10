# 快速开始

五种部署方式，选择适合你的：

## 方式一：本地运行

```bash
git clone https://github.com/avabbbb/Flovart.git
cd Flovart
npm install
npm run flovart:cli -- start --source --web --open
```

启动器会同时准备 WebUI 和本机 Browser Agent，并通过一次性启动握手打开主 Workflow 路由 `#/app`。不要直接把 `37522` 粘贴到地址栏来期待 Agent binding；直接地址只代表普通 WebUI 页面。首次没有配置 AI 服务时，先点「稍后再说」即可进入可编辑的 Canvas；需要生成时，再点击「添加 AI 服务」完成配置。

源码启动时 `37522` 只是首选端口：如果被占用，Flovart 会自动选择可用的本机端口并把实际地址写入启动结果。需要隔离测试时可运行 `npm run flovart:cli -- start --source --web --web-port=0 --agent-port=0 --no-open --json`。

自动化浏览器验收不要使用 `--open`，因为它会调用 Windows 默认浏览器；运行 `npm run test:browser:chrome`，脚本会使用 Playwright 的 Chrome for Testing、隔离 profile、随机端口和一次性 bootstrap URL，结束后自动清理测试进程。

> 推荐 [Google AI Studio](https://aistudio.google.com/apikey) 免费获取 Gemini 凭据。

## 方式二：用外部 Agent / CLI 指挥制作组

当前外部导演路径以 Codex CLI/Browser、Claude Code 和 OpenCode CLI 为主；它们通过 Operation Skill 使用同一套本机 CLI。DeepSeek Harness 是显式 Plugin/Profile projection，WorkBuddy 使用 CLI Connector + Skill；TeleAgent 可尝试本地 stdio MCP + canonical Skill，但真实客户端仍是 External Gate。CodeBuddy Code 与 Pi 通过稳定 contract 兼容。Flovart 不要求用户配置浏览器抓取或文件队列；MCP 仅是可选 transport。

```bash
npm run flovart:cli -- status --json
npm run flovart:cli -- start --open --json  # 仅在 status 未就绪时执行
npm run flovart:cli -- workflow.inspect --json
```

### 运行逻辑

- **外部 Harness 是导演台**：保留主对话、总体计划和跨任务调度；关闭 Flovart 不应终止 Harness。
- **Workspace Operator 是唯一内置执行 Agent**：只在单次有界 Intent 内调用类型化、可逆工具；Production Crew 是 Operator、Runtime 与 Worker 的执行面集合名，不是额外 Agent。
- **稳定 Agent surface**：正常操作只使用 `status`、`workflow.inspect`、`workflow.selection.get`、`workflow.apply` 与 `workflow.node.run`；仅在 bootstrap、兼容诊断或调试时读取 `command.list` / `command.schema`。
- **可见 Workflow 单一权威**：操作前确认 `status` 与 Workflow 已就绪，操作后用 `workflow.inspect` 回读；所有写操作都经当前 Browser Workflow authority。
- **密钥安全**：Provider Secret 只由 Flovart 的受控边界使用，CLI 与外部 Agent 均不得读取、输出或保存原始密钥。

### 示例命令

```bash
npm run flovart:cli -- workflow.inspect --json
```

写操作由外部 Agent 按当前 Skill 调用 `workflow.apply` 或 `workflow.node.run`，并在结果后重新 `workflow.inspect`。命令注册表可以离线读取；可见 Workflow 操作需要先启动 Flovart Desktop 并打开目标 Workflow。完整架构边界见 [生态架构设计包](../design/ecosystem/TARGET_ARCHITECTURE.md)。

DeepSeek Harness 的目标体验是在自身主壳中安装专用 Flovart Profile/Plugin：左侧固定 Flovart Dock 打开中央完整 Workflow、Table 与 Agent Production Control，快速弹层处理审批/状态/Artifact，右侧 Agent Bridge 管理连接与单导演 Handoff，并可弹出独立 Flovart 窗口。Host Plugin 仍从 CLI Registry 派生并执行模型工具，Client Plugin 只为 UI、事件和恢复使用受限本地通道。该 Profile 尚处于设计/迁移阶段；当前使用方式仍以 Operation Skill + CLI + 独立 Flovart 工作区为准。

## 方式三：第三方服务适配

Flovart 正在持续推进 **OpenAI-compatible** 第三方端点（如中转站、企业内网网关）适配。你可以在设置中选择 **自定义 Provider**，按以下方式接入：

1. **服务地址** — 填入你的端点地址（如 `https://api.example.com/v1/chat/completions`，Flovart 会自动裁剪到 `/v1`）
2. **API Key** — 填入你的访问凭据
3. **模型名** — 模型列表正常返回时会自动发现；没有模型列表时再手动输入（如 `gemini-3.1-flash-image`、`gpt-image-2`）
4. **能力声明** — 仅在高级配置中补充该服务支持的能力（图片 / 视频 / 文本），自定义模型会按此归类到下拉菜单

> **适配说明**：第三方兼容规则仍在持续迭代中。欢迎你一起完善适配规则与样例，帮助更多模型服务稳定接入。

### 支持的图片响应格式

- 标准 `b64_json`（OpenAI 原生格式）
- `data:image/...;base64,...` 完整 Data URL
- HTTPS 远程图片 URL
- Chat Completions 返回的 Markdown 图片链接（`![](https://...)`）

## 方式四：Docker 本地联调

```bash
git clone https://github.com/avabbbb/Flovart.git
cd Flovart
docker compose up --build -d
```

访问 http://localhost:1635。

当前 Compose 只用于 Web、Hub、Enterprise 与 PostgreSQL 的本地联调；静态资源生产路径、安全配置和正式部署尚未完成验收，不能据此宣称生产部署已就绪。

## 方式五：浏览器扩展

> 🔜 **正在准备上架 Chrome / Edge 商店，Coming Soon。**
>
> 当前可通过开发者模式加载：

```bash
npm run ext:build
```

1. 打开 `chrome://extensions/` 或 `edge://extensions/`
2. 开启「开发人员模式」
3. 点击「加载已解压的扩展程序」→ 选择 `dist-extension/` 目录

正式商店安装、权限和 Desktop 配对指南尚未发布；当前只按上述开发者模式步骤测试。
