# Iris 总体设计

> 状态：**Current truth**（2026-10-07 文档重构）。本文是产品与系统的唯一总纲；各模块细节见同目录模块文档，交互规则见[交互设计](01-interaction.md)。
> 标注约定：**已实现** = 代码在主干；**已验证** = 有 Support Matrix 证据；**设计目标** = 尚未实现；**假设** = 待真实环境确认。

## 1. 一句话

**在你已经在用的创作软件里，让你自己的 Agent 调用 Iris，给素材加一层可开关、可替换的 AI 创意层；原素材不动，复杂制作再展开 Iris。**

对外短句：*Your footage. Plus one layer.*

Iris（原 Flovart）是 local-first、agent-native、BYOK 的创作工作台。用户的模型、Key、素材和最终编辑权始终在用户一侧。

## 2. 目标用户与首个任务

- 首批用户：用 DaVinci Resolve Studio 21.1 做短视频、广告、创作者内容的个人剪辑师；同时会用 Codex / Claude Code 等 Coding Agent。
- 首个任务：选中时间线上的一个片段 → 描述想要的效果（可在画面上圈一笔）→ Iris 生成若干**叠加层候选** → 比较、选定 → 非破坏性送回宿主。
- 不是首个任务：让 AI 自动剪完一条片、替换整段原素材、实时 AI 视频。

## 3. 产品组成（模块地图）

| 模块 | 职责一句话 | 设计文档 |
| --- | --- | --- |
| Canvas / Workflow | 空间化、可见的生产图；人和 Agent 编辑同一份状态 | [10-canvas-workflow](10-canvas-workflow.md) |
| Table | 结构化批量媒体处理；结果显式提交回 Workflow / 素材库 | [11-table](11-table.md) |
| Agent | 外部 Agent 接入（Skill + CLI，MCP 为投影）、Agent 连接中心、内置 Assistant | [12-agent](12-agent.md) |
| Generation & Runtime | 一条生成路径：任务、Provider 路由、费用、持久素材、本地服务 | [13-generation-runtime](13-generation-runtime.md) |
| Creative Hosts | Resolve 首发；AE / PR / PS 后续；宿主轻面板、上轨道、原生效果 | [14-creative-hosts](14-creative-hosts.md) |
| Web, Community & Extension | 网站后端、作品社区、浏览器导入扩展、安装与发行 | [15-web-community-extension](15-web-community-extension.md) |
| 质量与治理 | 评测、证据、支持等级、文档治理 | [20-quality-and-governance](20-quality-and-governance.md) |

顶级产品 surface 固定为 **Canvas | Table | Agent**；Assistant / Context / History 只在 Canvas、Table 旁的 contextual drawer 中出现。

## 4. 设计原则

1. **原素材不被破坏**：默认新增结果（候选 → Media Pool → 新轨道）；替换必须显式确认、可恢复。
2. **一条生成路径**：面板、CLI、MCP、Canvas 调同一个任务函数；transport 只做参数与结果转换。
3. **单一权威**：每类状态只有一个保存者（见 §6）；其他入口只存引用。
4. **短路径**：只有出现第二个真实复用、独立状态所有权或进程 / 凭据边界时才拆模块；不建只转发的 Manager / Facade / Gateway。
5. **能力驱动、不硬编码**：工具、模型、候选数量、宿主能力、文案全部来自注册表 / 能力发现 / 配置，UI 按 schema 渲染（规则见交互设计 §3）。
6. **永不死锁**：任何状态都有出口，任何等待都可取消或超时，任何锁都会过期（规则见交互设计 §4）。
7. **真实状态优先**：动画不能掩盖失败、未知提交或 Provider 无响应。
8. **宿主原生感**：宿主里的 Iris 是一个窄而克制的 contextual inspector，不是聊天页、后台或缩小版 Canvas。

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
| 图层、轨道、效果参数、关键帧、撤销 | 宿主工程（Resolve / AE / PR / PS） | 目标引用与必要上下文 |
| 生成输入、任务状态、Provider 任务 ID、结果版本 | 本地生成服务 | taskId、进度、结果引用 |
| 已生成媒体 | 持久素材目录（内容寻址） | 素材 ID、相对路径、校验和 |
| Workflow 图 | Browser Workflow（当前权威） | 引用；修改走 mutation |
| Table 处理图 | Table 自身 | 显式提交的结果引用 |
| Agent 主会话 | Agent 官方运行时（Codex、Claude…） | 非秘密会话引用与任务关联 |
| Provider Key | 本机安全存储 | 永不进入宿主工程、Skill、日志、素材元数据 |

## 7. 系统主路径

~~~text
生成：宿主面板 / Canvas / CLI / MCP → 同一任务函数 → Provider 适配 → 持久素材版本 → 宿主 / Workflow / Table 消费
渲染：宿主效果 → 读取固定素材版本 → 混合 → 输出当前帧（不联网、不等待模型、不依赖 Agent 在线）
~~~

## 8. 路线图

| 阶段 | 交付 | 完成证据 |
| --- | --- | --- |
| R0 | Resolve 21.1 native MCP 真实连接 | 真实 Agent 读到当前项目与选择；记录版本与实际 tool 列表 |
| R1 | 最小闭环（不付费） | 当前选择 → fixture 叠加层 → 持久文件 → Media Pool；原时间线不变 |
| R2 | 轻面板收敛 | Current Clip → Tools → Generate → Task → Candidates → Add to Media Pool → Open in Iris |
| R3 | 一条真实 Provider | 真实付费、取消、unknown-submit、持久素材、Media Pool |
| R4 | 上新轨道（P1） | 叠加层放在源轨道上方并对齐；开关后原片逐像素不变；删除即撤销 |
| R5 | Replace / Commit（P2） | 显式确认、提交前复核目标、可撤销 |
| R6 | Resolve OFX | 仅当固定版本参数 / 关键帧 / 离线渲染被真实需求证明 |
| R7 | 恢复 AE / PR / PS | 各自真实 SDK 与宿主证据 |

进度清单见 [todo](../content/docs/progress/todo.mdx) 与 [pending-test](../content/docs/progress/pending-test.mdx)；支持等级只看 [SUPPORT_MATRIX](../../SUPPORT_MATRIX.md)。

## 9. 对外口径

| 场合 | 可用说法 | 条件 |
| --- | --- | --- |
| README | 本地优先的 Workflow 与 Agent 创作工具；宿主叠加层开发中 | 跟随 Support Matrix |
| 宣传片 / 概念片 | *Your footage. Plus one layer.*；可展示路线图能力 | 未上线能力在画面中标注 **Coming soon** |
| 宿主验证后 | 在 Resolve 中生成、比较并导入叠加层 | 真实宿主录屏与证据 |
| 性能 | 指定硬件与素材规格下的实测值 | 可复跑 Benchmark |

禁止未验证宣称：实时 AI 视频、支持所有模型 / 宿主、人物完美保留、跨 Agent 无缝记忆迁移、完全离线生成、云同步已完成、一键无人值守成片。

## 10. 术语

| 术语 | 含义 | 避免 |
| --- | --- | --- |
| Canvas | 空间化 Workflow 创作面 | Canvas / Art 双系统 |
| Table | 结构化媒体处理视图，不是第二份 Workflow 权威 | 隐式双写 |
| Agent surface | 顶栏的外部 Agent 连接中心：discover / prepare / status / switch | 全页聊天、Tasks / Artifacts 工作区 |
| Assistant drawer | Canvas / Table 旁的内置助手抽屉 | Host picker、Agent 安装 |
| Stable Agent operations | `status`、`workflow.inspect`、`workflow.selection.get`、`workflow.apply`、`workflow.node.run` | 每个 API 一个 tool |
| Layer（叠加层） | 带 Alpha、与源片段对齐的生成结果，不含源像素 | “替换原片” |
| Candidate | 尚未被应用的生成结果，先进入 Media Pool / 候选区 | 自动应用 |
| Generation task | 固定输入、目标、参数与幂等 ID 的一次生成 | 聊天会话 |
| Artifact | 有稳定 ID 和校验和的结果文件 | 临时 URL |
| Provider | 真正提供模型能力的服务 | Coding Agent、CLI、宿主 |
| Creative host | Resolve / AE / PR / PS 等宿主 | — |
| Native effect | 宿主保存并参与预览 / 导出的效果 | 面板按钮、网页预览 |
| Iris Link | 本地宿主 / Workflow 连接能力的代码名 | 第二份 Workflow、业务总线 |

历史概念（Production Crew、Director、Workspace Operator、Native Draft、Dock production control、enterprise credits）不再用于推导新功能。

## 11. 品牌与兼容标识

对外统一用 **Iris**。技术兼容标识（`flovart` CLI、npm 包名、Skill 路径、事件名、CSS data 属性）暂时保留；改名是独立迁移，必须带别名与弃用说明，不与普通文档 / UI PR 混做。
