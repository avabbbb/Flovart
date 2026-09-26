<h1 align="center">Iris</h1>

<p align="center">
  <strong>把 AI 创作 Agent 放进你本来就在用的专业工具里。</strong>
</p>

<p align="center">
  开源、本地优先的专业创作 AI 层——第一宿主从 DaVinci Resolve Studio 21.1 开始。<br />
  剪辑工程继续留在宿主里，Agent 理解上下文，Iris 负责生成、参考素材、持久产物与候选版本。
</p>

<p align="center">
  <sub><strong>原名 Flovart。</strong> 现在产品与仓库统一叫 Iris；旧的 <code>flovart</code> CLI、
  Skill / package 路径与内部兼容标识暂时保留，避免打断现有 Agent 与脚本。</sub>
</p>

<p align="center">
  <a href="./README.md">English</a> · 简体中文
</p>

<p align="center">
  <a href="https://avabbbb.github.io/Iris/"><strong>在线体验</strong></a> ·
  <a href="https://github.com/avabbbb/Iris/releases"><strong>下载预览版</strong></a> ·
  <a href="docs/overview/quick-start.md">快速开始</a> ·
  <a href="SUPPORT_MATRIX.md">兼容性</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Agent--native-E8453C" alt="Agent-native" />
  <img src="https://img.shields.io/badge/Local--first-E8453C" alt="本地优先" />
  <img src="https://img.shields.io/badge/BYOK-E8453C" alt="自带 API Key" />
  <img src="https://img.shields.io/badge/Image%20%2B%20Video-E8453C" alt="图片与视频" />
  <img src="https://img.shields.io/badge/License-MIT-E8453C" alt="MIT License" />
  <a href="https://github.com/avabbbb/Iris/releases"><img src="https://img.shields.io/github/downloads/avabbbb/Iris/total?color=E8453C&logo=github" alt="GitHub Downloads" /></a>
  <a href="https://github.com/avabbbb/Iris"><img src="https://img.shields.io/github/stars/avabbbb/Iris?color=E8453C" alt="GitHub Stars" /></a>
</p>

<p align="center">
  <a href="stats/README.md"><img src="https://tally.yuki.sh/hits/flovart/readme.svg?theme=rule34" alt="Iris README 访问计数" /></a>
  <br />
  <sub>README 展示次数 · 第三方计数，非独立访客</sub>
</p>

## 实际效果

<p align="center">
  <img src="pic/readme/hero-agent.gif" alt="外部 coding agent 正在编辑同一份可见的 Iris Workflow" width="880" />
  <br />
  <sub><strong>当前已录制的 Agent / Workflow 能力——自然语言变成节点与连线。</strong><br />
  这段录屏里没有任何人工操作：该 Agent（WorkBuddy codebuddy）全程经 typed CLI 驱动可见 Workflow，
  现场创建 3 个节点与 2 条连线，没有改动任何源码。未执行生成步骤，因此没有调用付费模型服务。
  Resolve native MCP → 候选 → Media Pool 的 Hero 仍属于真实宿主 External Gate，因此这里暂时不把它伪装成已完成。可复现记录见 <a href="docs/maintenance/readme/DEMO_RECORDING.md">DEMO_RECORDING.md</a>。</sub>
</p>

## Iris 现在已经能做什么

下面都是**当前版本真实录屏**，不是 Mock。Resolve native MCP → Candidate → Media Pool 仍然属于 External Gate，所以 README 顶部只展示今天已经有证据的能力。

<table>
  <tr>
    <td align="center" width="50%">
      <img src="pic/readme/features/agent-cli-live.gif" alt="Agent 通过 Iris typed operations 修改同一份可见 Workflow。" width="420" />
      <br /><sub><strong>Agent → 真实 Workflow。</strong>不是屏幕点击，操作直接落到同一个可编辑项目。</sub>
    </td>
    <td align="center" width="50%">
      <img src="pic/readme/features/canvas-prompt.gif" alt="创作者直接在当前节点上修改 Prompt。" width="420" />
      <br /><sub><strong>原地 Prompt。</strong>人和 Agent 最终落到同一份可见、可继续编辑的工作面。</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="pic/readme/features/crop.gif" alt="在 Iris 中裁剪图片并生成显式结果节点。" width="420" />
      <br /><sub><strong>图片操作。</strong>本地编辑得到明确、可复用的结果。</sub>
    </td>
    <td align="center">
      <img src="pic/readme/features/video-trim.gif" alt="在 Iris 中对视频片段执行裁剪。" width="420" />
      <br /><sub><strong>视频操作。</strong>裁剪等媒体工具直接在当前工作区本地运行。</sub>
    </td>
  </tr>
</table>

**更多真实操作 GIF 见下面的[完整功能演示](#功能演示)。**

**快速跳转：** [快速开始](#快速开始) · [功能演示](#功能演示) · [为什么是 Iris](#为什么是-iris) · [核心能力](#核心能力) · [使用你自己的模型](#使用你自己的模型) · [集成与兼容性](#集成与兼容性) · [架构](#架构) · [本地优先与安全](#本地优先与安全) · [路线图](#创作软件路线图) · [参与贡献](#参与贡献)

## 快速开始

### 创作者

1. 从 [GitHub Releases](https://github.com/avabbbb/Iris/releases) 下载预览版。
2. 打开 Iris，在设置中添加 AI 服务。
3. 新建或打开 Workflow，加入参考素材，开始创作。

公开 Releases 页面可能包含测试或预览产物；这不代表所有宿主或 Provider 都已 Stable。

### Coding Agent 用户

在版本化 CLI 包正式发布前，从源码检出运行：

```bash
git clone https://github.com/avabbbb/Iris.git
cd Iris
npm install
npm run flovart:cli -- start --source --web --open
npm run flovart:cli -- status --json
```

然后对本地 Agent 说：**「打开 Iris，在这个 Workflow 上干活。」**

正常 Agent 循环是 `status`、`workflow.inspect`、`workflow.selection.get`、`workflow.apply` 和 `workflow.node.run`；连接准备和诊断用 `ensure` 和 `doctor`；仅供开发使用的浏览器检查见[快速开始](docs/overview/quick-start.md)。

## 功能演示

下面每一条都是运行中应用的真实录屏：一个操作，从头到尾，没有合成帧、没有效果图。每条都裁到动作本身。

**Agent 原生，不是界面抓取。** 这些都是作用在同一份 Workflow 上的操作，而那份 Workflow 也可以由 Agent 驱动。上方 Hero 与[架构](#架构)段的 CLI 录屏是**全程由 Agent 驱动、没有任何人工操作**；下面的图库则是同一套界面由人手操作，因为那是新用户最先要走通的路径。节点的创建、连接、选择、视口、移动与缩放，以及各个节点工具，都已作为 typed operation 暴露给 Agent —— 走的是 revision 与幂等边界，而不是屏幕坐标。

视频与音频工具在浏览器内跑 ffmpeg.wasm，录制动作前会先预热 core，因此片段展示的是操作本身，而不是一次性约 30MB 的 wasm 下载 —— **所以片段时长不等于首次使用时的等待时间**。录制方法、可复现命令与边界见 [DEMO_RECORDING.md](docs/maintenance/readme/DEMO_RECORDING.md)。

### 画布操作

<table>
  <tr>
    <td align="center">
      <img src="pic/readme/features/canvas-add-node.gif" alt="从画布的添加节点菜单新增节点" width="420" />
      <br /><sub><strong>添加节点。</strong>工具栏的添加菜单涵盖图片、视频、文本、脚本、音频、配置。</sub>
    </td>
    <td align="center">
      <img src="pic/readme/features/canvas-connect.gif" alt="从一个节点拖出连线到另一个节点" width="420" />
      <br /><sub><strong>连接。</strong>从节点的输出把手拖到另一个节点，它就成为了输入。</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="pic/readme/features/canvas-drag.gif" alt="在画布上拖动节点" width="420" />
      <br /><sub><strong>手动摆放。</strong>节点自由移动，图本身就是状态。</sub>
    </td>
    <td align="center">
      <img src="pic/readme/features/canvas-tidy.gif" alt="一键整理画布布局" width="420" />
      <br /><sub><strong>一键整理。</strong>点一下重排整张图。</sub>
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <img src="pic/readme/features/canvas-prompt.gif" alt="在选中的节点上直接输入提示词" width="860" />
      <br /><sub><strong>就地写提示词。</strong>选中节点，直接在节点上写，不需要另开提示词对话框。</sub>
    </td>
  </tr>
</table>

### 图片节点

四个本地操作，跑在同一张本地生成的测试图上，各自产出真实的结果节点。全程不联系任何模型服务。

<table>
  <tr>
    <td align="center">
      <img src="pic/readme/features/crop.gif" alt="裁剪图片节点" width="420" />
      <br /><sub><strong>裁剪。</strong>设定裁剪范围后应用。</sub>
    </td>
    <td align="center">
      <img src="pic/readme/features/rotate.gif" alt="把图片节点旋转四分之一圈" width="420" />
      <br /><sub><strong>旋转与镜像。</strong>四分之一圈与翻转。</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="pic/readme/features/split-grid.gif" alt="把图片切成多个独立节点" width="420" />
      <br /><sub><strong>宫格切分。</strong>每一格成为独立且相连的图片节点。</sub>
    </td>
    <td align="center">
      <img src="pic/readme/features/filter.gif" alt="调整图片节点的调色" width="420" />
      <br /><sub><strong>调色。</strong>调整在应用前即可实时预览。</sub>
    </td>
  </tr>
</table>

### 视频节点

同样是本地的、同样不联系模型服务：这几条走浏览器内的 ffmpeg core，每条都产出自己的结果节点（音视频分离会产出两个）。

<table>
  <tr>
    <td align="center">
      <img src="pic/readme/features/video-trim.gif" alt="对视频节点做剪辑" width="420" />
      <br /><sub><strong>剪辑。</strong>设定起止点；剪切走 stream copy，不重编码。</sub>
    </td>
    <td align="center">
      <img src="pic/readme/features/video-av-split.gif" alt="把视频拆成静音视频节点与音频节点" width="420" />
      <br /><sub><strong>音视频分离。</strong>一个视频变成静音视频节点 + 一个音频节点。</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="pic/readme/features/video-merge.gif" alt="按顺序拼接两个视频节点" width="420" />
      <br /><sub><strong>拼接。</strong>选中多个视频节点，按顺序合成一个。</sub>
    </td>
    <td align="center">
      <img src="pic/readme/features/extract-frame-at.gif" alt="按指定时间点导出视频帧" width="420" />
      <br /><sub><strong>导出帧。</strong>选一个时间点，把视频里的那一帧变成图片节点。</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="pic/readme/features/extract-first-frame.gif" alt="导出首帧为图片节点" width="420" />
      <br /><sub><strong>首帧。</strong>一键得到图片节点。</sub>
    </td>
    <td align="center">
      <img src="pic/readme/features/extract-last-frame.gif" alt="导出尾帧为图片节点" width="420" />
      <br /><sub><strong>尾帧。</strong>同样一键，取片段末尾那帧。</sub>
    </td>
  </tr>
</table>

### 音频节点

<table>
  <tr>
    <td align="center">
      <img src="pic/readme/features/audio-trim.gif" alt="截取音频节点" width="420" />
      <br /><sub><strong>截取。</strong>同样的起止点控件，同样的 stream copy 剪切。</sub>
    </td>
    <td align="center">
      <img src="pic/readme/features/audio-speed.gif" alt="调整音频播放速度" width="420" />
      <br /><sub><strong>变速。</strong>0.25×–4×，保持音调不变。</sub>
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <img src="pic/readme/features/audio-stem-split.gif" alt="把音频分离为人声与伴奏" width="860" />
      <br /><sub><strong>人声/伴奏分离。</strong>输出两个音频节点；原理是立体声相位抵消，单声道或混音复杂的素材分离效果有限。</sub>
    </td>
  </tr>
</table>

### 外部 Agent 链路

<table>
  <tr>
    <td align="center">
      <img src="pic/readme/features/agent-cli-live.gif" alt="typed CLI 操作在可见画布上搭建节点图" width="420" />
      <br /><sub><strong>操作直接落在画布上。</strong>全程由 Agent 驱动、没有任何人工操作：<code>workflow.node.create</code> 与 <code>workflow.connect</code> 通过 typed CLI 执行，可见 Workflow 同步更新——不靠界面抓取，也没有第二份隐藏副本。</sub>
    </td>
    <td align="center">
      <img src="pic/readme/features/agent-open-panel.gif" alt="从画布工具栏打开 Agent 界面" width="420" />
      <br /><sub><strong>打开 Agent 界面。</strong>入口就在同一根画布工具栏上。</sub>
    </td>
  </tr>
</table>

尚未录制、也刻意没有展示的：依赖模型的生成能力与依赖模型的图片工具（图片生成、高清放大、移除背景、拆分图层、图片编辑/扩图）——本机未配置任何 Provider，没有可诚实展示的结果。该缺口登记在[录制记录](docs/maintenance/readme/DEMO_RECORDING.md)里。

## 为什么是 Iris？

很多 AI 创作工具要求你先把工作搬到它自己的画布里。**Iris 反过来：进入你已经在用的专业创作软件。**

宿主继续掌握剪辑工程和时间线，外部 Agent 读取创作上下文，Iris 负责生成、参考素材、持久 Artifact 和可审核的候选版本；只有多镜头、复杂引用或可复用 Workflow 真正需要时，才展开完整 Iris 工作区。

- **留在编辑器里。** 第一宿主方向是 DaVinci Resolve Studio 21.1；其它创作宿主在真实宿主验证前继续保持 Experimental。
- **Agent-native。** Agent 通过类型化能力和宿主原生控制面工作，不依赖鼠标坐标或屏幕抓取。
- **默认非破坏。** 生成结果先成为 Candidate；Resolve-first 的 P0 只做到 **Add to Media Pool**，不会先替换原 Timeline。
- **BYOK 图片与视频。** Provider、模型和 API Key 由你自己选择。
- **本地优先。** 在当前实现支持范围内，项目相关状态、参考素材与生成产物尽量留在创作工作区附近。

Canvas 仍然是多镜头、复杂依赖和 Workflow 编排的 power surface，**但它不再是 Iris 的产品前提。**

## 核心能力

| 能力 | Iris 的方式 |
| --- | --- |
| Agent 控制 | 通过类型化操作直接作用于真实可见 Workflow |
| 人类编辑 | 同一张图、素材和结果始终可以直接修改 |
| 模型 | BYOK 与多 Provider 适配，按具体能力标记状态 |
| 参考素材 | 图连接、提及、素材库和产物会解析成生成输入 |
| 自动化 | 显式的 inspect/apply/run 操作，带版本与审批边界 |
| 数据 | 本地优先，并明确浏览器与 Runtime 的边界 |

你可以把图片、文本、视频、音频和配置节点组合起来，让项目和参考素材留在自己的工作区，并通过明确契约扩展 Provider、宿主和节点操作。当前顶栏三个产品 surface 是：**Canvas** 负责空间化 Workflow，**Table** 负责结构化媒体处理，**Agent** 只负责本地/外部 Coding Agent 的连接、准备、状态与切换；内置 **Assistant / Context / History** 留在 Canvas/Table 右侧 drawer，不在 Agent 页复制——详见[功能说明](docs/content/docs/overview/features.mdx)。

## 同一份 Workflow，人和 Agent 共用

```text
你的 Agent                  Codex · WorkBuddy · Claude Code
      │
      ▼
Iris 操作                   inspect · select · apply · run
      │
      ▼
活着的 Workflow  ────────── 人
      │
      └──────────────────── 模型
```

用 Agent 时，一句 brief 会变成明确的操作：它读取当前项目和版本，应用这些操作，并可以运行一个已确认的节点。手工创作时，你照样可以添加、移动、调整大小和连接节点，拖入本地文件，配置模型，运行生成并继续迭代。两条路最终落在同一个 Workflow 权威状态上，所以 Agent 做的事你都能看见。

## 使用你自己的模型

```text
你的 Provider → 你的 API Key → 你的素材 + Workflow → 你的生成结果
```

Iris 不内置模型服务。你可以在应用中配置 Provider，按需选择能力和模型，并自行承担 Provider 条款、费用和产物权利。OpenAI-compatible BYOK 与远程 Provider 路径当前为 Experimental：代码里有适配器，不等于真实付费服务已认证。

## 集成与兼容性

| Host 或 package | 当前状态 |
| --- | --- |
| Codex CLI + Browser Workflow | Experimental |
| Claude Code CLI projection | Experimental |
| OpenCode CLI projection | Experimental |
| DeepSeek Harness RC8 bundle/profile | Experimental |
| WorkBuddy CLI Connector | Experimental |
| CodeBuddy Code | Planned |
| Pi | Planned |
| Photoshop UXP panel | Experimental |
| Premiere Pro UXP panel | Experimental |
| After Effects | Experimental |
| DaVinci Resolve Studio | Experimental |

`Experimental`、`Planned` 和 External Gate 都不是 Stable 能力。证据、边界与发布门槛统一记录在 [Support Matrix](SUPPORT_MATRIX.md)，那里是唯一的事实来源；这张表不是第二套兼容性政策。

## 架构

```mermaid
flowchart LR
  H["人类创作者"] <--> W["Live Workflow"]
  A["Coding Agent Harness"] --> L["Iris Link + flovart CLI"]
  L --> W
  W --> P["Provider 适配层"]
  W --> R["本地素材 + 产物"]
  T["Table 工作区"] -. 独立入口 .-> W
```

现有 `flovart` CLI 名称在 Iris 改名期间继续作为兼容入口。CLI 与实验性 stdio MCP 共用操作语义，当前都绑定可见的 Browser Workflow。确定性操作直接执行，不需要第二个 AI 再解释一遍。

<p align="center">
  <img src="pic/readme/agent-operations-live-workflow.gif" alt="Iris 兼容 CLI 操作在可见 Workflow 中创建节点与连线" width="720" />
  <br />
  <sub><strong>同一主张的操作级视角。</strong>一个项目和三个节点由 <code>workflow.project.create</code>、
  <code>workflow.node.create</code> 和 <code>workflow.connect</code> 创建（1.5 倍速播放）——
  上面 Hero 里那个外部 Agent 会话端到端驱动的正是这些 typed 操作。录制记录：
  <a href="docs/maintenance/readme/DEMO_RECORDING.md">DEMO_RECORDING.md</a>。</sub>
</p>

原生效果保持两条短路径：同一生成函数产出持久素材版本，宿主效果读取固定版本并本地渲染——不强制经过导演、Operator 或制作组层级。产品范围与系统边界统一见[主设计](docs/design/flovart-native-effects.md)，Agent transport/authority 见 [Agent Integration](docs/design/agent-integration.md)；历史 CURRENT/TARGET 架构报告不再参与当前产品决策。

## 本地优先与安全

- 当前项目、素材和生成历史主要保存在浏览器本地，不承诺云同步。
- 当前 Web 路径通过加密的 `localforage` Vault 在本地保存 API Key，前端再直接请求配置的模型服务；浏览器属于秘密边界的一部分。
- Web、桌面 WebView 和扩展的存储通常彼此隔离；通过受限 Runtime Bridge 跨入口同步仍在待办中。
- 不要把 API Key 写进 Prompt、日志或仓库。Agent 和 CLI 只能拿到脱敏后的就绪与能力状态，不能拿到原始凭据。
- 官方项目渠道仅包括本仓库、[在线 Demo](https://avabbbb.github.io/Iris/) 和本仓库 Actions 发布的桌面产物。请自行确认 Provider 条款，以及输入素材和输出内容的版权与合规性。

发现漏洞？请通过[安全政策](SECURITY.md)中的私密渠道报告。

## 创作软件路线图

当前第一宿主方向已经切换为 **DaVinci Resolve Studio 21.1 first**。

第一条产品闭环刻意保持很窄：

```text
当前 Resolve 选择
→ Agent 理解任务
→ Iris 生成持久 Candidate
→ 用户审核
→ Add to Media Pool
```

P0 不修改原 Timeline。Add to new track 是后续 gate；Replace / Commit 只有在目标重新校验与恢复语义跑通后才进入。Resolve OFX 也后置，只有真实工作流证明需要宿主持久参数、关键帧或离线 effect rendering 时才启动。

After Effects、Premiere Pro 与 Photoshop 现有工作继续保留为 Experimental，不用于宣称已认证宿主支持。

这些是方向，不是 Stable 支持。证据进度见[开发计划](docs/content/docs/progress/todo.mdx)、[待用户确认](docs/content/docs/progress/pending-test.mdx)和 [Support Matrix](SUPPORT_MATRIX.md)。

## 参与贡献

我们尤其欢迎三类贡献：Provider 适配、宿主集成和 Workflow 能力。请先提交 [Issue](https://github.com/avabbbb/Iris/issues/new/choose)，阅读[贡献约定](.github/CONTRIBUTING.md)，UI 变更附上验证证据。

## 致谢

感谢 [@labiaaaaaaaaa](https://github.com/labiaaaaaaaaa) 推进第三方服务适配与聚合端点修复。

## 协议与声明

Iris 基于 [MIT License](./LICENSE) 开源。使用本项目即表示同意[使用条款](./docs/TERMS_OF_SERVICE.md)和[隐私政策](./docs/PRIVACY_POLICY.md)。

Iris 不内置模型服务，也不对生成内容主张知识产权。你需要自行确认所选模型、输入素材和生成结果的版权、合规性与合法使用。更多信息见[项目数据与统计](stats/README.md)。