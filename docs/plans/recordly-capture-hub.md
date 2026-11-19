# 计划：真实操作录制与 Agent 剪辑工作台（Recordly 连接器 → Rust Capture → 视频制作 Hub）

状态：**计划草案 / 设计目标**（2026-11-15）。本文没有任何部分已实现；被接受的部分按 AGENTS.md §9 蒸馏进 [00 总体设计](../design/00-overview.md)、[12 Agent](../design/12-agent.md) 与 [16 Agent 视频流水线](../design/16-agent-video-pipeline.md) 后归档。标注沿用总纲：**已实现 / 已验证 / 设计目标 / 假设**。

## 0. 一句话

宣传片里最有说服力的是真实操作录屏。Iris 先用**连接器**接用户自装的 Recordly，把录屏和剪辑工程带进同一个 pipeline run；之后视许可证决定，做一个更省内存的 **Rust 录制 + Snipaste 式截图**伴生工具；最终 Iris 成为“录制 → 素材管理 → Agent 剪辑 → 评审 → 版本归档”的视频制作 Hub，现成 Skill 与片型工作流挂在上面。

## 0.5 产品形态：录制截图是本体，其余模块可插拔（设计目标）

很多人只需要一个**省内存的截图 + 录屏软件**，不需要 Agent，也不需要画布。所以伴生工具的形态反过来：录制截图是本体、可以单独安装使用，画布与 Agent 是可选模块。

| 模块 | 默认 | 内容 | 复用 |
| --- | --- | --- | --- |
| **Core** | 必装 | 录屏、截图、贴图、标注、本地素材库；不需要账号、不联网、不启动 Agent | — |
| 反推 | 可选 | 对截图 / 录屏帧反推提示词，BYOK，结果只存本机 | 与浏览器扩展同一套反推指令与解析（`prompt.reverse`、`reverse-prompt-core.js`） |
| 发送到画布 | 可选 | 截图 / 录屏发到 Iris 当前 Workflow，画布未打开时进 Import Inbox；首次需配对确认 | 与浏览器扩展同一条导入路径（分块传输 + sha256 + 内容寻址 Artifact Store），见 [15](../design/15-web-community-extension.md) §4 |
| Agent 剪辑 | 可选 | 录屏进入 pipeline run，Agent 合成、评审、定向修补 | 16 的 run / trace 与工具集 |
| Skill / 片型模板 | 可选 | 首发片、功能介绍片、品牌片等工作流 | H3 |

规则：

- **不装就零开销**：未启用的模块不加载代码、不常驻进程、不开端口；“省内存”的承诺只针对 Core 实测。
- 模块之间只通过已登记的命令与 artifact 交接，不共享私有状态；拔掉任何可选模块，Core 照常工作，已有素材不丢。
- 模块按需下载安装、可单独卸载；Key 与配对授权在模块卸载时一并清除。
- 浏览器扩展、桌面伴生工具、Iris Desktop 是同一能力的不同入口，不复制第二套反推、导入或素材系统。
- 本节只指线 A（截图 + 录制伴生工具）的形态；Iris 整体定位见 [00 总体设计](../design/00-overview.md) §1（原“三条产品线”远景已于 2026-11-17 归档，线 B / C 并入 Iris）。
- 这会改变对外产品定位（Iris 画布从主体变为可选模块之一），被接受前需要先改 [00 总体设计](../design/00-overview.md) 的产品一句话与 surface 说明。

## 1. 为什么需要

- [16](../design/16-agent-video-pipeline.md) §1 拆解的参考流程里，大量镜头是真实产品操作：点击、输入、切页、结果特写。
- 现有 `capture.ui`（**已实现**）只打开 localhost / 授权文件夹里的网页，用无头浏览器截图或录屏：录不到桌面 App、模拟器、多窗口操作，也没有真实光标、点击和键盘事件。
- 三级镜头接力（完整设备 → 页面内点击 → 结果特写）、点击圈、自动推近都需要**点击位置与时间**；录屏时记下这些事件，比事后让模型从画面里猜更准。
- Agent 需要一个可以精确改到每一秒的剪辑工作台。Recordly 本身就是一个现成的录制 + 时间线编辑方案。

## 2. Recordly 事实（2026-11-15 按官方仓库与站点核验）

| 项 | 事实 |
| --- | --- |
| 仓库 | `webadderallorg/Recordly`，v1.4.0（2026-09），约 3.6 万 star，最初 fork 自 OpenScreen |
| 许可证 | **AGPL-3.0 + 附加条款**：衍生作品须在用户可见 UI 与仓库中署名 Recordly；不得使用 Recordly 名称或品牌 |
| 技术栈 | Electron + TypeScript，平台原生捕获助手（C++ / Swift）：macOS ScreenCaptureKit，Windows Graphics Capture + WASAPI 回环音频，Linux 支持现代发行版 |
| 录制 | 整屏或窗口、麦克风与系统音频、摄像头气泡 |
| 编辑器 | 按光标活动建议自动缩放、光标平滑 / 动态模糊 / 点击动画、背景与边框、裁切、变速、注释、附加音轨，导出 MP4 / GIF |
| 工程 | 非破坏性编辑，`.recordly` 工程文件（`EditorProjectData`，含撤销快照与自动保存） |

**Snipaste** 是闭源免费软件：只借鉴它的交互（截图、自动识别窗口边界、贴图钉在屏幕上、标注、取色），不涉及任何代码。

## 3. 许可证边界（硬约束）

Iris 主仓库是 **MIT**。

- **不得**把 Recordly 源码（包括编辑器组件）复制、vendoring 或打包进 Iris 主仓库与安装包。
- 把 Recordly 代码**移植**成 Rust 仍是衍生作品：必须 AGPL、在 UI 与仓库署名、不能叫 Recordly。“重写成 Rust”不会改变这一点。
- 读取 Recordly **导出的文件**（MP4、`.recordly` 工程数据）、调用用户自装的 Recordly 进程，是进程与数据边界，不把 Iris 变成衍生作品（**假设**，正式发布前请法律复核）。
- 与 Hypit 的规则一致（AGENTS.md §2）：对齐分层与数据流，代码自写。

因此有三条路：

| 路线 | 做法 | 许可证结果 | 代价 |
| --- | --- | --- | --- |
| **A 连接器** | 用户自装 Recordly；Iris 发现安装、监视导出目录、导入 MP4 与工程元数据到 run | Iris 保持 MIT | 最小；受 Recordly 格式变动影响 |
| **B AGPL 伴生应用** | 单独仓库 fork Recordly，按自己的习惯小改、逐步 Rust 化、加截图；改名并署名；Iris 通过 A 的同一连接器调用 | 伴生应用 AGPL，Iris 仍 MIT | 中；要长期跟上游合并 |
| **C 净室自研** | 不看、不抄 Recordly 源码，按公开行为与文档用 Rust 自写录制 + 截图 + 编辑能力 | 可以 MIT | 最大；速度和内存优势要自己做出来 |

建议：**先做 A**（不管后面怎么做都要用到这个连接器）。

**决定（2026-11-15，用户）**：H2 走 **C 净室自研 Rust**，不使用 Recordly 源码。编写时不打开、不参照 Recordly 源码，只依据其公开文档、产品行为与本文 §2 的事实；这条在 PR 描述里声明。伴生工具许可证定为 **Apache-2.0**（2026-11-15 用户确认）；Iris 主仓库是否改许可证另行决定，已发布版本保持 MIT。

## 4. 分阶段

### H0：Recordly 连接器（设计目标）

- 发现：检测本机 Recordly 安装与版本；没有就返回 `CAPABILITY_UNAVAILABLE` + 安装链接，不静默跳过。
- 导入：用户在 Recordly 里录完导出后，把 MP4 作为 durable artifact 导入**当前 run**（复用 `asset.import`，`source = recordly`、记录 Recordly 版本与工程路径），trace 的 Step 照常由命令边界记录。
- 工程元数据（**假设**，需先读真实 `.recordly` 文件确认字段）：若工程里有光标轨迹、点击、缩放区间，解析成只读 sidecar JSON 一起入库，供合成 spec 对齐点击时间。
- 不做：遥控 Recordly 界面、修改其工程文件、在 Iris 里内嵌其编辑器。

### H1：Agent 剪辑工作台（设计目标）

- 在 Iris 自己的合成 spec（16 §4 / §12，**已实现**的 visual / text / captions / audio 四轨）上补“录屏专用”能力，用 Remotion 自写：按点击自动推近、光标平滑与点击圈、背景与圆角边框、设备样机、卡片从屏幕原位置展开。这些都是 MIT 自研，和 16 的三级镜头、C15 屏幕合成是同一组能力。
- Agent 用现有 `composition.patch`（基于版本、尊重 locked）改这些参数，评审仍走 `media.frames` + `review.submit`。
- 需要人手精修时，用户可回到 Recordly 原工程调整后重新导出，再由 H0 导入为新版本素材。

### H2：Rust 录制 + 截图伴生工具（设计目标，路线 B 或 C 待定）

- 录制：整屏 / 窗口 / 区域，系统音频 + 麦克风；同时写**事件轨**（光标、点击、按键，带时间戳）作为 sidecar，这是 H1 自动推近和三级镜头的输入。
- 截图（Snipaste 式交互）：区域截图、自动识别窗口与控件边界、贴图钉在屏幕上、标注、取色；截图直接成为 run 的 artifact。
- 形态：复用现有 Tauri / Rust Runtime 的进程边界与权限门；录屏开始前需要用户确认，并提示可能截入隐私信息。
- 目标是比 Electron 版更省内存、更快启动——这是**假设**，必须先实测 Recordly 1.4 的基线（空闲内存、1080p30 / 4K 录制时 CPU 与内存、导出耗时）再立目标。
- 平台捕获库（如 Windows Graphics Capture、ScreenCaptureKit 的 Rust 绑定）选型前按当期官方文档与维护状态核验。

### H3：视频制作 Hub（设计目标）

- 素材与版本：录屏、截图、底片、干声、每版渲染全部是带 sha256 的 artifact，挂在 run → version 上（复用 16 的 trace，不建第二套素材或任务系统）。
- 片型工作流：首发片 / 功能介绍片 / 品牌形象片（16 §1 三种打法）做成可复用的 run 模板与 Skill 命令文档。
- 外部 Agent 全流程：Codex / Claude Code / DSH 通过同一注册表的 CLI / MCP 调用录制、导入、合成、评审，写同一条 trace。

## 5. 与现有规则的关系

- `capture.ui` 继续负责本机网页的无人值守截图 / 录屏；桌面级真实操作录制走本计划的连接器或伴生工具，两者产物都进同一个 run。
- 内置 Agent 仍不获得 shell 或任意文件读写；录制工具只能由用户确认后启动，并只写 artifact store。
- 支持状态只在 `SUPPORT_MATRIX.md` 升级；未实测前对外不宣传“已集成 Recordly”或内存优势。

## 6. 验收

| 阶段 | 完成证据 |
| --- | --- |
| H0 | Windows 与 macOS 各一台真机：Recordly 录一段操作 → 导出 → 导入当前 run → artifact sha256 可查 → 进入一版合成并渲染；未安装时返回诊断 |
| H1 | 同一段录屏按点击自动推近、点击圈、停留阅读时间，Agent 一轮评审后定向修补，locked 片段不变 |
| H2 | 与 Recordly 1.4 同机同参数对比内存 / CPU / 导出耗时的实测表；事件轨与画面误差 ≤ 1 帧 |
| H3 | 用一个片型模板从录制到成片跑完一条 run，外部 Agent 与内置 Agent 写入同一 runId |

## 7. 待决问题

1. ~~H2 走 B 还是 C~~：已定 C（净室自研 Rust）。伴生工具许可证：已定 Apache-2.0。
2. 对 Recordly 编辑器的“小改”具体是哪些习惯（快捷键、时间线布局、默认导出参数）？
3. 伴生工具是独立仓库 / 独立安装包，还是作为 Iris 的可选组件分发？（按 §0.5，倾向：Core 独立安装包，画布 / Agent 为可选模块）
4. 对外品牌：用户认为 Iris 与同名项目（另一个受 Lovart 启发的 Iris 画布仓库）及 Lovart 本身撞名，考虑改名；带 Canvas 的组合名（SnapCanvas、ClipCanvas、ShotCanvas 等）2026-11-15 检索均已被占用，其中 SnapCanvas 就是截图软件。改名按 AGENTS.md §0 单独做，不混入功能改动。
