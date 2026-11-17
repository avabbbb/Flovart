# Flovart 总体设计

> 状态：**Current truth**（2026-10-07 文档重构）。本文是产品与系统的唯一总纲；各模块细节见同目录模块文档，交互规则见[交互设计](01-interaction.md)。
> 标注约定：**已实现** = 代码在主干；**已验证** = 有 Support Matrix 证据；**设计目标** = 尚未实现；**假设** = 待真实环境确认。

## 1. 一句话

Flovart 有两条并行的定位（2026-11-17 定案）：

- **Flovart（Canvas + Agent）是 Workflow 生产工具**：在可见的无限画布上编排节点、生成、素材与版本；你自己的 Agent（Codex、Claude Code、DSH…）通过 Skill + CLI 调用同一套命令。宿主插件给素材加一层可开关、可替换的 AI 创意层，原素材不动，复杂制作再展开 Flovart。
- **Iris 是全能后期助手（Personal agent）**：Web 版独立可用——对话优先，Flovart 无限画布是它的产出面，不装任何剪辑软件也能用。可选地连接本地宿主插件（DaVinci Resolve 先，Premiere、剪映 / CapCut 后续）同步剪辑上下文，免手动上传。核心主张：Agent 读完整工程上下文（图层、合成、关键帧、标记、素材），输出可编辑的工程改动或画布节点，而不是烤死的成片。见 [11-iris](11-iris.md)。

对外短句：*Your footage. Plus one layer.*（宿主叠加层）

Flovart是 local-first、agent-native、BYOK 的创作工作台。用户的模型、Key、素材和最终编辑权始终在用户一侧。

## 2. 目标用户与首个任务

- 宿主线首批用户：用 DaVinci Resolve Studio 21.1 做短视频、广告、创作者内容的个人剪辑师；同时会用 Codex / Claude Code 等 Coding Agent。
- 宿主线首个任务：选中时间线上的一个片段 → 描述想要的效果（可在画面上圈一笔）→ Flovart 生成若干**叠加层候选** → 比较、选定 → 非破坏性送回宿主。
- 不是首个任务：让 AI 自动剪完一条片、替换整段原素材、实时 AI 视频。
- Iris 线首个任务（设计目标）：在 Web 上用一句话说清要做的后期改动（可拖入素材）→ Iris 把计划与候选落到画布 → 用户在画布上比较、改、选定。连上 Resolve 后，同一任务直接从当前时间线取上下文。

## 3. 产品组成（模块地图）

| 模块 | 职责一句话 | 设计文档 |
| --- | --- | --- |
| Canvas / Workflow | 空间化、可见的生产图：节点、生成、素材、版本——GenAI 基本盘；人和 Agent 编辑同一份状态 | [10-canvas-workflow](10-canvas-workflow.md) |
| Iris（全能后期助手 · Personal agent） | 对话优先的个人 Agent，画布为产出面：run、可见光标、trace、评审版本；可选宿主上下文连接器；Hypit 式逆向拆解是它的一组工具 | [11-iris](11-iris.md) |
| Agent | Agent 连接与状态管理：runtime、模型 / Provider、外部 Agent（Codex、Claude Code、DSH…）、连接健康与每个 Agent 的状态；Skill + CLI（MCP 为投影） | [12-agent](12-agent.md) |
| Generation & Runtime | 一条生成路径：任务、Provider 路由、费用、持久素材、本地服务 | [13-generation-runtime](13-generation-runtime.md) |
| Creative Hosts | Resolve 首发；AE / PR / PS 后续；宿主轻面板、上轨道、原生效果；同时是 Iris 的可选上下文连接器 | [14-creative-hosts](14-creative-hosts.md) |
| Web, Community & Extension | 网站后端、作品社区、浏览器导入扩展、安装与发行 | [15-web-community-extension](15-web-community-extension.md) |
| 质量与治理 | 评测、证据、支持等级、文档治理 | [20-quality-and-governance](20-quality-and-governance.md) |

### 3.1 三个顶级 surface（2026-11-13 定案，2026-11-17 逆向改名 Iris）

顶栏固定为 **画布 Canvas｜Iris｜Agent**（内部 `canvasView: 'reverse'` 与 `reverse` 目录在单独迁移前保持）：

| Surface | 拥有 | 调用 / 被调用 |
| --- | --- | --- |
| 画布 Canvas | 节点、连线、生成任务、素材库、版本 / take / batch、`workflow.*` 命令 | 被 Iris 与外部 Agent 调用；选中节点可“交给 Iris” |
| Iris | 对话 + run（计划 → 步骤 → 评审轮次 → 版本）、多 Agent 光标、trace / 计划 / 审批、预览与版本对比、逆向拆解工具、可选宿主上下文连接器；当前 tab 是 coming-soon 占位 | 调用 Canvas 的 `workflow.*` 与 Generation 的同一任务函数；使用 Agent 页供应的 Agent 与模型 |
| Agent | runtime、模型 / Provider 路由、外部 Agent 发现 / 准备 / 健康 / 状态、Skill 安装 | 向 Iris 供应 Agent 与模型；不放对话与 run 编辑 |

Canvas 旁的 Assistant drawer 保留为轻量上下文入口：就地问答与单步操作；多步制作“在 Iris 中继续”，进入同一个 run。一套业务实现：Iris、抽屉、CLI、MCP 都调用同一组命令，光标只是调用的可视化。交互细节见 [01](01-interaction.md) §11–§12，视觉见 [DESIGN.md](DESIGN.md)。

提案中：Agent 驱动的产品宣传片流水线（run / trace、评审循环、素材归档）见 [16-agent-video-pipeline（PROPOSAL）](16-agent-video-pipeline.md)，其放置已按本节改为 Iris。

## 4. 设计原则

1. **原素材不被破坏**：默认新增结果（候选 → Media Pool → 新轨道）；替换必须显式确认、可恢复。
2. **一条生成路径**：面板、CLI、MCP、Canvas 调同一个任务函数；transport 只做参数与结果转换。
3. **单一权威**：每类状态只有一个保存者（见 §6）；其他入口只存引用。
4. **短路径**：只有出现第二个真实复用、独立状态所有权或进程 / 凭据边界时才拆模块；不建只转发的 Manager / Facade / Gateway。
5. **能力驱动、不硬编码**：工具、模型、候选数量、宿主能力、文案全部来自注册表 / 能力发现 / 配置，UI 按 schema 渲染（规则见交互设计 §3）。
6. **永不死锁**：任何状态都有出口，任何等待都可取消或超时，任何锁都会过期（规则见交互设计 §4）。
7. **真实状态优先**：动画不能掩盖失败、未知提交或 Provider 无响应。
8. **宿主原生感**：宿主里的 Flovart 是一个窄而克制的 contextual inspector，不是聊天页、后台或缩小版 Canvas。
9. **连接器可选**：Iris 不依赖任何宿主；宿主连接器只读起步、按需同步上下文，没有连接器时不阻塞。

## 5. 关键决策（保留自历史 ADR）

| 决策 | 内容 | 来源 |
| --- | --- | --- |
| 第一宿主 | DaVinci Resolve Studio 21.1；Agent 宿主操作用 Blackmagic native MCP；不做第二套 Resolve MCP | 用户 2026-09-25 |
| 首个输出形态 | **叠加层（Layer）优先**：带 Alpha、与源片段对齐；整段“新版本”保留为第二种输出 | 用户 2026-10-07；**假设**：所选 Provider 能产出可用 Alpha |
| 写入分级 | P0 导入 Media Pool；P1 上新轨道；P2 Replace / Commit | 风险分级 |
| 本地优先 | 个人任务与素材由本机管理；网站后端不做生成中转 | ADR 0002 |
| 稳定素材 | Artifact 用稳定 ID + 校验和；临时 URL / Blob / base64 不是长期素材 | ADR 0010 |
| 共用任务实现 | 所有入口调同一任务函数；提交不明先查询 | ADR 0023 / 0069 |
| Schema 驱动路由 | 模型能力由 Route Capability Schema 描述，PromptBar 与 Preflight 用同一 schema | ADR 0027 |
| Contract-first 投影 | CLI / MCP / Native SDK 是同一 operation contract 的投影 | ADR 0070 |
| Workflow 修改 | 必带 projectId + expectedRevision + mutationId；幂等 | ADR 0065 |
| 费用授权 | 执行代码校验费用；Agent 工具权限 ≠ 费用授权 | ADR 0068 |
| 本地文件夹 | 显式授权目录用引用语义，不复制字节 | ADR 0071 |
| 浏览器扩展 | 桌面权威的受限导入桥，分块 + 内容寻址 | ADR 0060 |
| 平台 | Windows 优先；macOS 后续单独验证 | 用户确认 |

旧 ADR 原文见 [archive/2026-10-07/adr](../archive/2026-10-07/adr/)。

## 6. 状态归属

| 数据 | 唯一保存者 | 其他入口保存什么 |
| --- | --- | --- |
| 图层、轨道、效果参数、关键帧、撤销 | 宿主工程（Resolve / AE / PR / PS） | 目标引用与必要上下文；Iris 连接器只读同步，不另存一份工程 |
| 生成输入、任务状态、Provider 任务 ID、结果版本 | 本地生成服务 | taskId、进度、结果引用 |
| 已生成媒体 | 持久素材目录（内容寻址） | 素材 ID、相对路径、校验和 |
| Workflow 图 | Browser Workflow（当前权威） | 引用；修改走 mutation |
| 逆向工程（Script、证据、对齐、变体） | Iris 的逆向拆解工具（`useReverseStore`） | 子画布节点上的 reverseProjectId 与镜头 key |
| run / trace / 评审轮次（提案） | 本地 Runtime（[16](16-agent-video-pipeline.md)） | Iris 与画布节点只存 runId / version 引用 |
| Agent 主会话 | Agent 官方运行时（Codex、Claude…） | 非秘密会话引用与任务关联 |
| Provider Key | 本机安全存储 | 永不进入宿主工程、Skill、日志、素材元数据 |

## 7. 系统主路径

~~~text
生成：宿主面板 / Canvas / CLI / MCP → 同一任务函数 → Provider 适配 → 持久素材版本 → 宿主 / Workflow / Iris 消费
渲染：宿主效果 → 读取固定素材版本 → 混合 → 输出当前帧（不联网、不等待模型、不依赖 Agent 在线）
~~~

## 8. 路线图

| 阶段 | 交付 | 完成证据 |
| --- | --- | --- |
| R0 | Resolve 21.1 native MCP 真实连接 | 真实 Agent 读到当前项目与选择；记录版本与实际 tool 列表 |
| R1 | 最小闭环（不付费） | 当前选择 → fixture 叠加层 → 持久文件 → Media Pool；原时间线不变 |
| R2 | 轻面板收敛 | Current Clip → Tools → Generate → Task → Candidates → Add to Media Pool → Open in Flovart |
| R3 | 一条真实 Provider | 真实付费、取消、unknown-submit、持久素材、Media Pool |
| R4 | 上新轨道（P1） | 叠加层放在源轨道上方并对齐；开关后原片逐像素不变；删除即撤销 |
| R5 | Replace / Commit（P2） | 显式确认、提交前复核目标、可撤销 |
| R6 | Resolve OFX | 仅当固定版本参数 / 关键帧 / 离线渲染被真实需求证明 |
| R7 | 恢复 AE / PR / PS | 各自真实 SDK 与宿主证据 |

R0–R7 是宿主线；Resolve 部分同时作为 Iris 的第一个连接器。Iris 线：

| 阶段 | 交付 | 完成证据 |
| --- | --- | --- |
| I0 | Web Iris：对话优先的个人 Agent，画布为产出面；替换当前 coming-soon 占位 | 不连任何宿主，从一句话到画布上的计划与候选；run 可回放 |
| I1 | Resolve 只读上下文连接器 | 连上 Resolve 后 Iris 读到当前项目、时间线与选择，无需上传；写回仍只 Add to Media Pool |
| I2 | Premiere（UXP）、剪映 / CapCut 连接器 | 剪映 6.0+ 草稿加密（待验证）、CapCut 国际版草稿格式（待验证）先核对再立项；不做破解 |

进度清单见 [todo](../content/docs/progress/todo.mdx) 与 [pending-test](../content/docs/progress/pending-test.mdx)；支持等级只看 [SUPPORT_MATRIX](../../SUPPORT_MATRIX.md)。

## 9. 对外口径

| 场合 | 可用说法 | 条件 |
| --- | --- | --- |
| README | 本地优先的 Workflow 与 Agent 创作工具；宿主叠加层开发中；Iris 即将推出（不写“已可用”或“自动读取剪辑工程”） | 跟随 Support Matrix |
| 宣传片 / 概念片 | *Your footage. Plus one layer.*；可展示路线图能力 | 未上线能力在画面中标注 **Coming soon** |
| 宿主验证后 | 在 Resolve 中生成、比较并导入叠加层 | 真实宿主录屏与证据 |
| 性能 | 指定硬件与素材规格下的实测值 | 可复跑 Benchmark |

禁止未验证宣称：实时 AI 视频、支持所有模型 / 宿主、人物完美保留、跨 Agent 无缝记忆迁移、完全离线生成、云同步已完成、一键无人值守成片。

## 10. 术语

| 术语 | 含义 | 避免 |
| --- | --- | --- |
| Canvas | 空间化 Workflow 创作面 | Canvas / Art 双系统 |
| Iris（全能后期助手 · Personal agent） | 顶栏第二个 surface（原名 逆向 / Reverse）：对话优先、画布为产出面的个人 Agent；逆向拆解是其工具；宿主连接器可选；不是第二份 Workflow 权威 | 用 Iris 指代 Flovart 本身；没有画布产出的纯聊天页、隐式双写、复制 Hypit 源码 |
| 旧代号 Iris | 2026-10 前 Flovart 的旧品牌（`Iris Link`、`Iris CLI`、`Iris Studio`、`iris-*` 兼容字段）；与 Iris surface 无关 | 在新文档里沿用；兼容字段按 §11 保留 |
| Agent surface | 顶栏的 Agent 连接与状态中心：runtime、模型、外部 Agent 的 discover / prepare / status / switch | 对话、run 编辑、Tasks / Artifacts 工作区 |
| Assistant drawer | Canvas 旁的轻量上下文助手；多步制作交给 Iris 的同一 run | Host picker、Agent 安装、独立 run 主场 |
| Stable Agent operations | `status`、`workflow.inspect`、`workflow.selection.get`、`workflow.apply`、`workflow.node.run` | 每个 API 一个 tool |
| Layer（叠加层） | 带 Alpha、与源片段对齐的生成结果，不含源像素 | “替换原片” |
| Candidate | 尚未被应用的生成结果，先进入 Media Pool / 候选区 | 自动应用 |
| Generation task | 固定输入、目标、参数与幂等 ID 的一次生成 | 聊天会话 |
| Artifact | 有稳定 ID 和校验和的结果文件 | 临时 URL |
| Provider | 真正提供模型能力的服务 | Coding Agent、CLI、宿主 |
| Creative host | Resolve / AE / PR / PS 等宿主 | — |
| Native effect | 宿主保存并参与预览 / 导出的效果 | 面板按钮、网页预览 |
| Flovart Link | 本地宿主 / Workflow 连接能力的代码名 | 第二份 Workflow、业务总线 |

历史概念（Production Crew、Director、Workspace Operator、Native Draft、Dock production control、enterprise credits）不再用于推导新功能。

## 11. 品牌与兼容标识

对外产品名统一用 **Flovart**；Iris 只是第二个 surface 的名字。技术兼容标识（`flovart` CLI、npm 包名、Skill 路径、事件名、CSS data 属性）暂时保留；改名是独立迁移，必须带别名与弃用说明，不与普通文档 / UI PR 混做。
