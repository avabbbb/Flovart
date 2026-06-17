<p align="center">
  <img src="pic/LOGO_optimized.png" alt="Flovart Logo" width="200" />
</p>

<h1 align="center">Flovart</h1>

<p align="center">
  <strong>开源版 Lovart — 自带 Key、接入所有模型、把画布变成 Agent 的运行时</strong>
</p>

<p align="center">
  <a href="https://avabbbb.github.io/Flovart/" target="_blank"><strong>👉 在线体验 Demo</strong></a>
</p>

<p align="center">
  <a href="https://avabbbb.github.io/Flovart/">在线体验</a> •
  <a href="docs/overview/quick-start.md">快速开始</a> •
  <a href="docs/overview/features.md">功能特性</a> •
  <a href="docs/progress/roadmap.md">开发计划</a>
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

## 📸 双工作区预览

<table>
  <tr>
    <td width="50%">
      <img src="pic/Canvas.png" alt="Canvas 工作区" />
      <p align="center"><strong>Canvas 工作区</strong> - 无限画布 + AI 创作</p>
    </td>
    <td width="50%">
      <img src="pic/WorkFlow.png" alt="Workflow 工作区" />
      <p align="center"><strong>Workflow 工作区</strong> - 节点式流程编排</p>
    </td>
  </tr>
</table>

---

## 这是什么？

我想要一个真正为 AI 创作而生的画布——

- **更自由的模型**：BYOK 自带 Key，Google / OpenAI / DeepSeek / MiniMax / 火山引擎 / Qwen 等 12+ Provider 原生接入，再加一层 OpenAI-compatible 中转站适配器，自己接任何端点。
- **更彻底的工作流**：Canvas（画布）+ Workflow（节点流）双工作区架构，一键切换；节点式太重就把它收起来当工具人，专注画布创作。
- **更可被驱动**：CLI（`tools/flovart/cli.js`）、SKILL.md 和 host config 三条确定性入口，画布上的每个媒体元素都暴露成命令。外部 Agent 负责规划，Flovart 负责执行。
- **更好看的前端**：Animal Crossing 风的 Tactile Shell 视觉语言、无限画板、`@` 引用图层、双击聚焦 / 三击适配、双语 + 亮暗主题自适应。

四种部署形态可选：在线 Demo、Tauri 桌面端、Chrome/Edge 浏览器扩展、Docker 自托管。

如果你也有相同的愿望，欢迎提交 PR。

## 特别致谢

**[@labiaaaaaaaaa](https://github.com/labiaaaaaaaaa)** — 推进第三方服务适配核心修复，帮助 Flovart 在聚合网关与兼容端点场景下持续完善接入规则。

---

## 🚀 快速开始

```bash
git clone https://github.com/avabbbb/Flovart.git
cd Flovart
npm install
npm run dev
```

打开 http://localhost:3217，在设置中填入你的服务凭据即可。

> 推荐 [Google AI Studio](https://aistudio.google.com/apikey) 免费获取 Gemini 凭据。

更多部署方式（Agent / CLI、Docker、浏览器扩展等）请查看 [快速开始文档](docs/overview/quick-start.md)。

---

## 🎯 功能特性

Flovart 更推荐按创作链路使用，而不是把每个能力拆开记：

| 工作流 | 你会怎么用 |
| ------ | ---------- |
| **导入参考图** | 把角色、场景、产品或草图拖进画布，作为后续生成的视觉锚点。 |
| **@ 引用画布节点** | 在节点下方的 PromptBar 输入 `@`，直接把画布里的图片、视频或文本节点作为上下文。 |
| **生成 4 个方案** | 围绕同一组参考图批量生成 2/4 个方向，快速比较构图、风格和细节。 |
| **A/B 对比与局部修正** | 用对比视图挑选结果，再对选中图片做局部重绘、扩图、去背景、超分或滤镜调整。 |
| **保存为素材** | 把满意的角色、场景、道具沉淀进素材库，后续直接拖回画布复用。 |
| **让 Agent 继续扩展** | 外部 Agent 可以通过 CLI / SKILL 读取画布、点火节点、重试失败任务，并继续扩展镜头或视频。 |

**核心能力**：无限画布、AI 文生图/图生图/文生视频、Multi-Agent 协作、局部重绘/扩图、滤镜调色、图层蒙版、批量生成、提示词润色、角色锁定、素材库、12+ Provider、双语主题切换。

完整功能列表请查看 [功能特性文档](docs/overview/features.md)。

---

## 📋 开发计划

### 已完成 ✅

- [X] 无限画布 + 基础设计工具
- [X] 多 Provider BYOK 系统（12+ Provider）
- [X] AI 文生图 / 图生图 / 文生视频
- [X] Agent-Native CLI（30+ 确定性命令）
- [X] Canvas ↔ Workflow 双工作区切换
- [X] Docker / Tauri 桌面端 / 在线 Demo
- [X] 第三方 API 聚合端点全兼容
- [X] Tactile Shell AC 视觉语言

### 进行中 🚧

- [ ] Chrome / Edge 商店上架
- [ ] 扩展端服务凭据加密存储
- [ ] 节点流可视化编辑器迭代

### 规划中 📝

- [ ] LangGraph.js Agent 编排
- [ ] AI 短剧一键流水线
- [ ] 实时协作（CRDT）
- [ ] 插件市场

完整开发计划请查看 [开发计划文档](docs/progress/roadmap.md)。

---

## 🤝 参与贡献

1. Fork 本仓库
2. 创建分支 `git checkout -b feature/xxx`
3. 提交更改 `git commit -m 'Add xxx'`
4. 推送 `git push origin feature/xxx`
5. 提交 Pull Request

> [CONTRIBUTING.md](./CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

---

## ⭐ Star History

如果 Flovart 对你有帮助，给个 Star ⭐ 支持一下！

[![Star History Chart](https://api.star-history.com/svg?repos=avabbbb/Flovart&type=Date)](https://star-history.com/#avabbbb/Flovart&Date)

---

## 📄 协议与声明

本项目基于 [GNU Affero General Public License v3.0 only](./LICENSE) 开源。

使用本产品即表示同意 [使用条款](./TERMS_OF_SERVICE.md) 和 [隐私政策](./PRIVACY_POLICY.md)。

### 非官方部署声明

Flovart 官方发布渠道仅限于：

- **GitHub 仓库**：[github.com/avabbbb/Flovart](https://github.com/avabbbb/Flovart)
- **在线 Demo**：[avabbbb.github.io/Flovart](https://avabbbb.github.io/Flovart)
- **桌面版构建**：本仓库 Actions 签发的 EXE / DMG / deb / AppImage

除上述地址外，任何第三方公开部署、镜像站点、托管服务、改版服务、整合包、网盘分发均为非官方行为，与作者无关。

**请勿在非官方站点输入 API Key 或其他敏感信息。**

### AI 生成内容

Flovart 是本地优先的 AI 创作工具，通过你自行配置的第三方 API Key 调用模型服务。你使用本工具生成的所有图片、视频、文本内容均由你控制的 API Key 和模型产出，**你需对生成内容的合规性、版权归属、使用合法性自行负责**。

Flovart 不内置任何模型服务、不存储用户的 API Key、不对生成内容做任何知识产权声明。
