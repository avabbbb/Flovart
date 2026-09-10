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

## 方式二：用 Agent / CLI / MCP 操作 Workflow

当前可沿用 Codex、Claude Code、OpenCode 的 Skill/CLI，以及 WorkBuddy 的 CLI Connector。另有实验性本地 stdio MCP，共用现有操作入口；每个助手的实际安装、登录和调用状态见[支持矩阵](../../SUPPORT_MATRIX.md)。TeleAgent 接入准备包不等于真实客户端已认证。

```bash
npm run flovart:cli -- status --json
npm run flovart:cli -- start --open --json  # 仅在 status 未就绪时执行
npm run flovart:cli -- workflow.inspect --json
```

日常操作使用 status、workflow.inspect、workflow.selection.get、workflow.apply、workflow.node.run；ensure 准备连接，command.list/schema 仅作 discovery 和诊断。写入前核对目标与版本，写入后回读；确定性命令不需要额外内部 AI 重新解释。

从源码启动 MCP：

```bash
node tools/flovart/mcp-server.js
```

在支持本地 stdio 的客户端配置上述进程入口，工作目录指向本仓库；具体配置按该客户端文档和实际版本核验。MCP 的五个工具仍操作已绑定的可见 Browser Workflow，不提供无 UI 原生效果能力。详见[当前操作契约](../design/ecosystem/OPERATION_SURFACE.md)。

现有 DSH 适配继续使用自己的服务入口，但不要求所有用户安装 DSH、导演台或完整 Dock。Agent/CLI/MCP 不读取、输出或保存原始 Provider key；工具可调用不等于已批准付费生成。

插件与内部 Agent 双入口的新产品方向见[主设计](../design/flovart-native-effects.md)。不要把当前面板或 MCP 安装成功当作原生效果已可用。

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
