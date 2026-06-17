# 快速开始

五种部署方式，选择适合你的：

## 方式一：本地运行

```bash
git clone https://github.com/avabbbb/Flovart.git
cd Flovart
npm install
npm run dev
```

打开 http://localhost:3217，在设置中填入你的服务凭据即可。

> 推荐 [Google AI Studio](https://aistudio.google.com/apikey) 免费获取 Gemini 凭据。

## 方式二：Agent / CLI 控制画布

Flovart 提供本地 agent-native CLI 控制面，供 OpenCode、Claude Code、Codex、Cursor、Windsurf、Roo 等外部 Agent 或 shell 脚本操作画布。主路径只依赖 CLI，不需要 Chrome DevTools Protocol 端口。

```bash
npm run dev
npm run flovart:cli -- status --json
npm run flovart:cli -- canvas.inspect --json
```

### 运行逻辑

- **本地数据命令**：`canvas.inspect`、`canvas.add-image`、`workflow.load`、`provider.select-model` 等直接读写本地 file-state runtime。
- **浏览器执行命令**：`generate.image`、`generate.video`、`element.ignite`、`workflow.run` 等写入 `.flovart/command-queue.json`，由打开中的 Flovart 浏览器页通过 Vite dev server 轮询并执行。
- **统一命令注册表**：所有 CLI 命令仍由 `tools/flovart/core.js` 定义，外部 Agent 只负责规划，Flovart 只执行确定性命令。
- **密钥安全**：API Key 只在 Flovart 浏览器 UI 中录入和使用。CLI 不读取、不输出、不保存密钥。

### 示例命令

```bash
npm run flovart:cli -- canvas.add-image --href "data:image/png;base64,..." --name "Reference" --json
npm run flovart:cli -- generate.image --prompt "cinematic product poster" --json
```

## 方式三：第三方服务适配

Flovart 正在持续推进 **OpenAI-compatible** 第三方端点（如中转站、企业内网网关）适配。你可以在设置中选择 **自定义 Provider**，按以下方式接入：

1. **Base URL** — 填入你的端点地址（如 `https://api.example.com/v1/chat/completions`，Flovart 会自动裁剪到 `/v1`）
2. **服务凭据** — 填入你的访问凭据
3. **模型名** — 选择或手动输入模型（如 `gemini-2.5-flash-preview-image-generation`、`gpt-image-1` 等）
4. **能力声明** — 勾选该凭据支持的能力（图片 / 视频 / 文本），自定义模型会按此归类到下拉菜单

> **适配说明**：第三方兼容规则仍在持续迭代中。欢迎你一起完善适配规则与样例，帮助更多模型服务稳定接入。

### 支持的图片响应格式

- 标准 `b64_json`（OpenAI 原生格式）
- `data:image/...;base64,...` 完整 Data URL
- HTTPS 远程图片 URL
- Chat Completions 返回的 Markdown 图片链接（`![](https://...)`）

## 方式四：Docker 部署

```bash
git clone https://github.com/avabbbb/Flovart.git
cd Flovart
docker-compose up -d
```

访问 http://localhost:3217。

更多 Docker 配置选项请参考 [Docker 部署指南](../deployment/docker.md)。

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

更多扩展安装详情请参考 [浏览器扩展指南](../deployment/browser-extension.md)。
