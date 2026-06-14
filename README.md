<p align="center">
  <img src="pic/LOGO.png" alt="Flovart Logo" width="200" />
</p>

<h1 align="center">Flovart</h1>

<p align="center">
  <img src="pic/Workspace.png" alt="Flovart" width="100%" />
</p>

<p align="center">
  <strong>开源版 Lovart — 自带 Key、接入所有模型、把画布变成 Agent 的运行时</strong>
</p>

<p align="center">
  <a href="https://avabbbb.github.io/Flovart/" target="_blank"><strong>👉 在线体验 Demo</strong></a>
</p>

<p align="center">
  <a href="https://avabbbb.github.io/Flovart/">在线体验</a> •
  <a href="#-开始使用">开始使用</a> •
  <a href="#-功能一览">功能一览</a> •
  <a href="#-开发计划">开发计划</a>
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
  <a href="https://avabbbb.github.io/Flovart/" target="_blank">
    <img src="https://img.shields.io/badge/🌐_在线体验_Demo-点击打开-E8453C?style=for-the-badge" alt="Demo" />
  </a>
</p>

---

## 这是什么？

我想要一个真正为 AI 创作而生的画布——

- **更自由的模型**：BYOK 自带 Key，Google / OpenAI / DeepSeek / MiniMax / 火山引擎 / Qwen 等 12+ Provider 原生接入，再加一层 OpenAI-compatible 中转站适配器，自己接任何端点。
- **更彻底的工作流**：Canvas（画布）+ Workflow（节点流）双工作区架构，一键切换；节点式太重就把它收起来当工具人，专注画布创作。
- **更可被驱动**：CLI（`tools/flovart/cli.js`）、MCP（`flovart.*`）、SKILL.md（Claude Code / OpenCode / Codex 可直接调用）三条确定性入口，画布上的每个媒体元素都暴露成命令。外部 Agent 负责规划，Flovart 负责执行。
- **更好看的前端**：Animal Crossing 风的 Tactile Shell 视觉语言、无限画板、`@` 引用图层、双击聚焦 / 三击适配、双语 + 亮暗主题自适应。

四种部署形态可选：在线 Demo、Tauri 桌面端、Chrome/Edge 浏览器扩展、Docker 自托管。

如果你也有相同的愿望，欢迎提交 PR。

## 特别致谢

**[@labiaaaaaaaaa](https://github.com/labiaaaaaaaaa)** — 推进第三方服务适配核心修复，帮助 Flovart 在聚合网关与兼容端点场景下持续完善接入规则。

---

## 🚀 开始使用

五种方式，选适合你的：

### 方式一：本地运行

```bash
git clone https://github.com/avabbbb/Flovart.git
cd Flovart
npm install
npm run dev
```

打开 http://localhost:3217，在设置中填入你的服务凭据即可。

> 推荐 [Google AI Studio](https://aistudio.google.com/apikey) 免费获取 Gemini 凭据。

### 方式二：Agent / CLI 控制画布

Flovart 提供本地 agent-native CLI 控制面，供 OpenCode、Claude Code、Codex、Cursor、Windsurf、Roo 等外部 Agent 或 shell 脚本操作画布。现在主路径不再依赖 MCP，也不需要 Chrome DevTools Protocol 端口。

```bash
npm run dev
npm run flovart:cli -- status --json
npm run flovart:cli -- canvas.inspect --json
```

运行逻辑：

- **本地数据命令**：`canvas.inspect`、`canvas.add-image`、`workflow.load`、`provider.select-model` 等直接读写本地 file-state runtime。
- **浏览器执行命令**：`generate.image`、`generate.video`、`element.ignite`、`workflow.run` 等写入 `.flovart/command-queue.json`，由打开中的 Flovart 浏览器页通过 Vite dev server 轮询并执行。
- **统一命令注册表**：所有 CLI 命令仍由 `tools/flovart/core.js` 定义，外部 Agent 只负责规划，Flovart 只执行确定性命令。
- **密钥安全**：API Key 只在 Flovart 浏览器 UI 中录入和使用。CLI 不读取、不输出、不保存密钥。

示例：

```bash
npm run flovart:cli -- canvas.add-image --href "data:image/png;base64,..." --name "Reference" --json
npm run flovart:cli -- generate.image --prompt "cinematic product poster" --json
```

### 方式三：第三方服务适配（持续进行中）

Flovart 正在持续推进 **OpenAI-compatible** 第三方端点（如中转站、企业内网网关）适配。你可以在设置中选择 **自定义 Provider**，按以下方式接入：

1. **Base URL** — 填入你的端点地址（如 `https://api.example.com/v1/chat/completions`，Flovart 会自动裁剪到 `/v1`）
2. **服务凭据** — 填入你的访问凭据
3. **模型名** — 选择或手动输入模型（如 `gemini-2.5-flash-preview-image-generation`、`gpt-image-1` 等）
4. **能力声明** — 勾选该凭据支持的能力（图片 / 视频 / 文本），自定义模型会按此归类到下拉菜单

> **适配说明**：第三方兼容规则仍在持续迭代中。欢迎你一起完善适配规则与样例，帮助更多模型服务稳定接入。

**支持的图片响应格式**：

- 标准 `b64_json`（OpenAI 原生格式）
- `data:image/...;base64,...` 完整 Data URL
- HTTPS 远程图片 URL
- Chat Completions 返回的 Markdown 图片链接（`![](https://...)`）

### 方式四：Docker

```bash
git clone https://github.com/avabbbb/Flovart.git
cd Flovart
docker-compose up -d
```

访问 http://localhost:3217。

### 方式五：浏览器扩展

> 🔜 **正在准备上架 Chrome / Edge 商店，Coming Soon。**
>
> 当前可通过开发者模式加载：

```bash
npm run ext:build
```

1. 打开 `chrome://extensions/` 或 `edge://extensions/`
2. 开启「开发人员模式」
3. 点击「加载已解压的扩展程序」→ 选择 `dist-extension/` 目录

---

## 🎯 功能一览

| 功能                     | 说明                                                                        |
| ------------------------ | --------------------------------------------------------------------------- |
| **Canvas / Workflow 切换** | 底栏一键切换画布模式 ↔ 节点流模式，共享同一份画布状态                        |
| **无限画布**       | 缩放平移、画笔、形状、文字、箭头、图层管理、智能对齐                        |
| **AI 文生图**      | 输入提示词生成图片，支持 Gemini / DALL-E / SDXL 等                          |
| **AI 图片编辑**    | 选中图片 + 提示词 → 局部重绘、去背景、超分辨率                             |
| **AI 扩图**        | 选择方向自动扩展画面内容                                                    |
| **AI 文生视频**    | Veo / Sora 文字生成视频，支持多宽高比                                       |
| **AI Agent**       | 多角色 Agent 群聊协作（创意总监、提示词工程师、风格大师等），讨论后自动出图 |
| **滤镜/调色**      | 亮度、对比度、饱和度、色调、模糊、复古等实时调节                            |
| **图层蒙版**       | 非破坏性遮罩，画笔擦除/恢复                                                 |
| **批量生成**       | 一次生成 2/4 张方案，对比选择                                               |
| **提示词润色**     | 一键 LLM 自动优化提示词                                                     |
| **@引用**          | 输入框 `@` 引用画布元素作为参考图                                         |
| **角色锁定**       | 锁定角色外观，后续生成保持一致                                              |
| **素材库**         | 角色/场景/道具分类管理，拖入画布复用                                        |
| **多 Provider**    | Google、OpenAI、DeepSeek、MiniMax、火山引擎、Qwen 等 12+ Provider           |
| **第三方服务适配** | 持续适配 OpenAI-compatible 中转站/聚合端点，并不断补充兼容规则              |
| **凭据自动识别**   | 粘贴服务凭据自动识别 Provider + 拉取可用模型                                |
| **A/B 对比**       | 拖拽滑块对比两张图片                                                        |
| **中英双语**       | 界面中文 / English 自由切换                                                 |
| **亮暗主题**       | 亮色 / 暗色主题自适应，Workflow 界面完整支持                                 |

---

## 📋 开发计划

### 已完成 ✅

- [X] 无限画布 + 基础设计工具
- [X] 多 Provider BYOK 系统（12+ Provider）
- [X] AI 文生图 / 图生图 / 文生视频
- [X] Multi-Agent 协作群聊（含历史子视图 + 日志持久化）
- [X] 滤镜/调色/图层蒙版
- [X] AI 局部重绘 / 扩图
- [X] 用量监控 + Key 批量管理
- [X] 浏览器扩展 MVP（v1.2.0）
- [X] Docker 部署
- [X] Tauri 2 桌面端（Win / macOS / Linux）
- [X] 在线 Demo（GitHub Pages）
- [X] 第三方 API 聚合端点全兼容（自动 baseUrl 裁剪、/chat/completions 降级、多图片格式解析）
- [X] SSE 流式图片反推提示词 + 取消
- [X] App.tsx 模块化拆分（hooks 抽离：`useCanvasInteraction` / `useGeneration` / `useApiKeys` / `useToast`）
- [X] Agent-Native CLI（`tools/flovart/cli.js`，30+ 确定性命令）
- [X] MCP 工具桥（`flovart.*`） + SKILL.md（Claude Code / OpenCode / Codex 直接驱动）
- [X] 图层拖拽排序 + 实时 drop indicator
- [X] 双击图层聚焦 / 三击空白适配视图
- [X] Tactile Shell AC 视觉语言（tab bar / 图层卡片 / 弹窗 / 页脚统一）
- [X] 紧凑化页脚（4 chip：使用条款 / 隐私政策 / 主题 / 语言切换）
- [X] **Canvas ↔ Workflow 双工作区切换**（底栏切换按钮 + 独立底栏 UI）
- [X] **Workflow 亮暗主题适配**（白天模式浅色背景 + 深色模式深色背景）

### 进行中 🚧

- [ ] Chrome / Edge 商店上架
- [ ] 扩展端服务凭据加密存储 + 跨设备同步
- [ ] Tauri 自动更新通道（Updater plugin 已接入，待签发测试版）
- [ ] 节点流可视化编辑器迭代（多选 / 折叠 / 模板导入）
- [ ] 第三方端点适配规则扩充（中转站 / 企业内网网关 / 自定义鉴权）

### 规划中 📝

- [ ] **LangGraph.js Agent 编排** — 节点流背后的运行时换成 LangGraph，支持自定义 Skills（类 GPTs）
- [ ] **AI 短剧一键流水线** — Brief → Storyboard → 镜头分镜 → 视频成片
- [ ] **多画板 / 多页面** — Workspace 间共享同一画布集合
- [ ] **实时协作（CRDT）** — 多人编辑同一画布，光标 / 选区同步
- [ ] **画布性能优化** — 针对 >500 元素场景的渲染优化
- [ ] **插件市场** — Provider / 节点 / 模板可打包分发
- [ ] **移动端适配** — 触屏手势 + 简化版 Toolbar
- [ ] **桌面端系统集成** — 系统托盘 / 全局快捷键 / 文件拖入

---

## 🤝 参与贡献

1. Fork 本仓库
2. 创建分支 `git checkout -b feature/xxx`
3. 提交更改 `git commit -m 'Add xxx'`
4. 推送 `git push origin feature/xxx`
5. 提交 Pull Request

> [CONTRIBUTING.md](./CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

---

## ⭐ Star

如果 Flovart 对你有帮助，给个 Star ⭐ 支持一下！

[![Star History Chart](https://api.star-history.com/svg?repos=avabbbb/Flovart&type=Date)](https://star-history.com/#avabbbb/Flovart&Date)

---

## 免责声明

### 非官方部署声明

Flovart 官方发布渠道仅限于：

- **GitHub 仓库**：[github.com/avabbbb/Flovart](https://github.com/avabbbb/Flovart)
- **在线 Demo**：[avabbbb.github.io/Flovart](https://avabbbb.github.io/Flovart)
- **桌面版构建**：本仓库 Actions 签发的 EXE / DMG / deb / AppImage

除上述地址外，任何第三方公开部署、镜像站点、托管服务、改版服务、整合包、网盘分发均为非官方行为，与作者无关。

**请勿在非官方站点输入 API Key 或其他敏感信息。** 第三方部署可能收集、存储或篡改你的凭据，作者无法对此类行为负责。

### AI 生成内容

Flovart 是本地优先的 AI 创作工具，通过你自行配置的第三方 API Key 调用模型服务。你使用本工具生成的所有图片、视频、文本内容均由你控制的 API Key 和模型产出，**你需对生成内容的合规性、版权归属、使用合法性自行负责**。

Flovart 不内置任何模型服务、不存储用户的 API Key、不对生成内容做任何知识产权声明。

### 免责范围

- 本软件按"现状"提供，不提供任何明示或暗示的担保，包括但不限于适销性、特定用途适用性或非侵权性担保
- 因使用或无法使用本软件导致的任何直接、间接、附带、特殊或后果性损害，作者不承担责任
- 第三方 API 提供商的定价、可用性、输出质量、内容审核、数据留存策略由各自提供商负责，与本项目无关
- 修改版、非官方构建、第三方 fork 的行为不在本声明覆盖范围内

---

## 📄 协议

本项目基于 [GNU Affero General Public License v3.0 only](./LICENSE) 开源。

使用本产品即表示同意 [使用条款](./TERMS_OF_SERVICE.md) 和 [隐私政策](./PRIVACY_POLICY.md)。
