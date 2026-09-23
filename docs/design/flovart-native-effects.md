# Flovart 当前产品与系统主设计

> Canonical current design. 文件名保留为 `flovart-native-effects.md` 仅为兼容既有链接；本文不再把“原生效果插件”当成 Flovart 的唯一产品身份。

本文是 Flovart 当前唯一的产品与系统主设计。它定义当前 IA、状态权威、Agent 边界、生成与素材边界，以及创作软件宿主扩展方向。历史 Agent / Crew / Director / Operator / Production Skill / Dock / Enterprise 方案不得反向覆盖本文。

配套 current-truth 文档：
- [Agent Integration](./agent-integration.md)
- [Adaptive Layout](./adaptive-layout.md)
- [当前功能](../content/docs/overview/features.mdx)
- [待办](../content/docs/progress/todo.mdx)
- [待测试确认](../content/docs/progress/pending-test.mdx)
- [Support Matrix](../../SUPPORT_MATRIX.md)

## 1. 一句话产品定义

Flovart 是一个 local-first、agent-native 的视觉制作工作台：人和 Coding Agent 操作同一份可见 Workflow；用户继续拥有模型、API Key、素材和最终编辑权。

创作软件插件与原生效果是 Flovart 的宿主扩展方向，不是另一套产品，不重建第二份 Workflow，也不要求所有用户先进入插件。

## 2. 当前信息架构

当前顶栏只有三个产品 surface：

| Surface | 当前职责 | 不承担 |
| --- | --- | --- |
| **Canvas** | 空间化 Workflow：素材、节点、连线、生成、结果与手工编辑 | Agent 连接管理；完整聊天工作区 |
| **Table** | 结构化媒体处理：选择输入、执行局部处理、把结果送回 Workflow/素材库 | 第二份 Workflow 权威；Agent 会话 |
| **Agent** | 本地/外部 Coding Agent 的发现、准备、连接状态与切换中心 | 内置 Assistant；任务聊天；Context/History 副本 |

Canvas 和 Table 旁边共享一个 contextual right drawer：

- **Assistant**：Flovart 内置助手，只针对当前项目工作；
- **Context**：当前 Workflow 上下文；
- **History**：生成历史。

硬边界：

- Agent 页不得重新嵌入 Assistant。
- Assistant drawer 不负责 Host picker / Agent 安装 / 连接管理。
- 不再创建 Agent full-page chat workspace。
- 不把 Canvas/Table/Agent 再包装成 Crew、Director、Operator 等必经产品层。
- 不恢复旧 Canvas/Art 双系统。

## 3. Agent 产品模型

外部 Agent 是一等调用者，但不是 Workflow 权威。

默认接入路径：

1. Agent Integration Skill 告诉 Codex、WorkBuddy、Claude Code 等如何调用 Flovart。
2. CLI 是默认 transport。
3. MCP 是同一 operation contract 的可选投影。
4. 内置 Assistant 调用同一业务能力，不拥有更高权限。

稳定 model-facing baseline 保留：

- `status`
- `workflow.inspect`
- `workflow.selection.get`
- `workflow.apply`
- `workflow.node.run`

`ensure` / `doctor` 属于连接准备与诊断，不是模型日常操作面。Canonical Skill 可以在当前五个稳定 operation 无法安全表达某个兼容动作时记录少量 granular helper；helper 不是新的产品 surface，也不能绕过同一 mutation/authority 边界。

禁止为了一个 Host 再复制 Workflow schema、Provider route、权限模型或生成实现。详细边界见 [Agent Integration](./agent-integration.md)。

## 4. 状态与权威

| 状态 | 当前权威 |
| --- | --- |
| 可见 Workflow 图、节点、选区、viewport | Browser Workflow store / browser binding |
| Agent 连接发现、准备、状态 | Flovart Link / host discovery |
| 长任务、Provider job、Artifact | Local Runtime / existing task implementation |
| 浏览器本地项目、素材库、生成历史 | 当前 browser local-first storage |
| 创作软件工程、原生效果参数、关键帧 | 对应宿主工程 |

规则：

- Agent 只能通过公开 operation 修改 Workflow，不能直接写 React/Zustand 或数据库。
- 同一任务只有一份 durable identity；重试依赖幂等与查询，不复制任务。
- Provider key 不进入 Skill、连接器、项目或日志。
- “已准备/已连接”不等于真实 Agent 会话已成功执行。
- Browser Workflow 当前仍是稳定 Agent 操作的可见权威；未来迁移必须先改 contract，再改文档。

## 5. Workflow、Table 与素材

Canvas 的 Workflow 是当前主要创作状态。

Table 是独立的媒体处理视图，可以拥有自己的局部处理状态，但结果通过明确的素材/节点引用回到 Workflow 或素材库；它不是第二个产品数据库，也不与 Canvas 做隐式双写。

素材必须保留真实来源和可恢复身份。远端 URL、临时 data URL 或聊天消息不能冒充 durable artifact。

## 6. 生成路径

确定性路径保持短：

生成入口（UI / Agent operation / future host panel）
→ 同一 generation/business function
→ Provider adapter
→ durable result/artifact
→ 可见 Workflow / Table / host consumer

不引入：
- Director → Crew → Operator → Worker 的强制链；
- MCP → CLI 子进程 → 第二套业务逻辑；
- 为未来假设预建通用 Manager / Facade / Bus。

费用确认、目标绑定、幂等、取消、提交未知恢复和素材完整性属于业务函数自身，不因“精简”删除。

## 7. Skill 与 recipe

正式产品概念只有 **Agent Integration Skill**：教外部 Agent 如何使用 Flovart 的稳定操作。

仓库里既有 VOX、Production Skill catalog、recipe 等代码/内容可以继续作为实验方法或兼容资产存在，但：

- 不作为一级 IA；
- 不进入 Agent 页 onboarding 的必经流程；
- 不建立 Production Skill Marketplace 作为当前产品承诺；
- 不要求新功能先编译成 Production Skill 才能运行。

相关遗留代码按真实调用点逐步收敛，不能仅因文档降级就整目录删除。

## 8. 创作软件宿主与原生效果

AE / Premiere / Photoshop / Resolve 集成继续作为重要扩展方向。当前支持级别必须以 [Support Matrix](../../SUPPORT_MATRIX.md) 为准。宿主集成只是一组 projection，不创建第二套 Workflow、Provider、任务或权限模型。

### 8.1 三层产品职责

| 层 | 用户目的 | UI 原则 | 不承担 |
| --- | --- | --- | --- |
| **宿主轻面板 / Workflow Integration** | 从当前图层、素材或 clip 发起生成，把结果带回宿主 | 小、快、贴近宿主；只展示当前选择、参考、意图、模型/目标、执行状态与结果 | 完整画布、复杂编排、第二份历史/资产库 |
| **原生 Effect / OFX** | 在宿主时间线/Effect Controls 中保存参数、关键帧与固定素材版本并稳定预览/导出 | 优先使用宿主原生参数与交互；效果实例就是工程的一部分 | 网络生成、Agent 会话、长任务调度 |
| **Flovart Canvas** | 复杂 Workflow、跨素材编排、版本比较、依赖与 Agent 协作 | 完整视觉工作台 | 冒充宿主原生 Effect UI |

宿主面板的核心闭环固定为：

```text
当前选择
→ 描述想做什么 / 添加参考
→ 选择必要的模型与输出位置
→ 查看将要执行的生成计划
→ 生成
→ 结果作为新素材/新图层/Media Pool item 返回宿主
→ 复杂修改时打开同一 Flovart Workflow
```

默认不要把完整 Canvas 塞进 300–400px 面板。面板只解决“当前宿主上下文里的下一步”，复杂工作显式展开到 Flovart。

### 8.2 面板 UI 设计基线

面板遵循宿主而不是 Flovart 网页首页的视觉重量：

- 使用宿主主题、字号、控件密度和键盘焦点；品牌只保留低重量 wordmark/状态，不做大 Hero。
- 首屏必须先显示**当前选择**和**下一动作**，不能先放模型市场、Provider 设置或历史大列表。
- Prompt/intent 是主输入，但允许“当前选择作为参考”、附加参考和短 recipe；recipe 只是填充意图，不创建第二套 Production Skill 产品层。
- 模型选择默认 `Auto`，只有用户需要控制成本/能力时展开；Provider key 永不进入宿主 panel。
- “生成并添加”前，若会产生付费调用、多个变体或覆盖性动作，显示 compact plan/费用范围；范围不变时不重复确认。
- 运行中展示真实阶段、取消/失败/重试语义；未知提交先查询，不把 timeout 当作“未发生”。
- 结果默认以**新增**方式导入；替换/覆盖必须是明确动作，并保留上一版本引用。
- History 只展示当前宿主会话/对象的最近结果；完整版本、依赖与跨项目历史回 Flovart Canvas。
- 窄面板优先单列滚动；避免固定大缩略图、横向工具条和多级 tab。高级设置折叠，不与主 CTA 争视觉权重。
- 面板断开 Flovart 时只显示可行动恢复状态（连接、重试、打开 Flovart），不暴露内部端口、Writer/Lease/Projection 术语。

### 8.3 After Effects

AE 当前分成两条明确路径，不能混写：

1. **实验面板**：仓库当前仍是 CEP/ExtendScript bridge，只用于“选中图层 → Flovart 生成 → 新素材/新图层”的轻入口；它不等于 native effect，也不能因为 Adobe 正在推进 UXP 就宣称 AE 已迁 UXP。
2. **原生效果**：使用 After Effects C++ Effect SDK。参数、关键帧、保存/重开与渲染由 Effect Controls / Timeline / Composition UI 承担；需要直接操控画面时才使用 SDK 的 custom ECW / Comp UI。

原生 effect 第一版保持极小参数面：

- **Source / Version**：固定到 durable local artifact，切换版本不触发网络；
- **Blend / Mix**：可关键帧；
- **Status**：素材缺失、版本不可读等明确状态；
- **Open in Flovart / Generate new version**：如果宿主 API/面板能安全提供命令入口，它只发起异步任务，不进入 render callback。

Position、Scale、Mask、Feather、Tracking 等宿主已有能力优先交给 AE 自己，不在 Flovart effect 里复制编辑器。

Adobe 是否为 After Effects 提供可发布的 UXP host 路径必须以当期官方 host 文档为准；在此之前，CEP panel 与 C++ Effect SDK 分别按现状维护，不做“全量 Web UI 直接迁入 AE”的假设。

### 8.4 DaVinci Resolve

Resolve 第一阶段是 **Resolve Studio Workflow Integration** 轻面板，而不是声称嵌入 Inspector 的 native panel：

- 从 `Workspace > Workflow Integrations` 打开；
- 当前实现按 Electron sandbox + `contextIsolation` + preload/contextBridge 组织，不在 renderer 开 `nodeIntegration`；
- 对支持 Promise API 的 Resolve 版本优先使用异步 API，避免 UI 因同步 scripting call 阻塞；
- 首个闭环只做“当前 Media Pool / timeline selection → materialize → Flovart → Media Pool import”；
- 在没有稳定 selection identity 与撤销语义前，不自动插入/替换 timeline item。

Resolve 的 **OFX effect** 是另一条 planned 路径：效果实例保存固定版本和宿主参数，在 render path 仅读取本地素材；生成、下载、Agent 与费用确认都在效果渲染之外完成。

### 8.5 原生效果共同约束

- 生成任务异步产生固定素材版本；
- 宿主预览/导出只读取固定素材，不在 render callback 请求网络；
- 参数随宿主工程保存；
- 保存重开、离线导出、素材移动/缺失必须真实验证；
- 首批验证优先 Windows，其他平台按真实证据升级；
- 色彩空间、alpha、帧率、时间基准和像素格式必须进入 artifact metadata 与宿主验收，不用“看起来正常”替代验证；
- UI/Effect 的“已加载”与 Provider/Agent 的“已连接”分开显示，避免把宿主可用性与在线生成能力绑死。

宿主实现细节和真实验证清单见 `integrations/studio/`。这部分是 roadmap / host integration，不改变 Flovart 当前 Canvas | Table | Agent IA。

## 9. 响应式布局

布局以 container-driven composition 为当前基线：

- App shell、Studio surface、Workflow space 使用明确的容器责任；
- Canvas/Table/Assistant drawer 根据实际容器宽度 reflow；
- 不恢复 `rightPanelInset`、固定 viewport 补丁或结构性 absolute columns；
- 每个 surface 明确唯一主要 scroll owner。

详细规则见 [Adaptive Layout](./adaptive-layout.md)。

## 10. 当前明确不采用

以下属于历史方案，不再是当前设计：

- Agent = 对话 / Tasks / Artifacts / Context 的完整顶级工作区；
- Agent 被彻底降级为唯一 global drawer、取消顶级 Agent surface；
- Production Crew / Director / Workspace Operator 作为用户必经层；
- Production Skill / VOX 作为一级产品分类或市场；
- Enterprise organizations / credits / approval / API-key pool 产品模型；
- Dock / Native Draft / DSH 专用架构成为所有 Agent 的公共主链；
- 多份 CURRENT / TARGET / AUDIT 文档共同决定产品方向。

历史背景统一见 [2026-09-23 文档 canonicalization 快照](../archive/historical-design/2026-09-23-canonicalization.md)。

## 11. 文档与验证规则

产品事实优先级：

1. 当前用户明确决定；
2. 当前可运行代码与真实 UI；
3. 本文与其它 current-truth 文档；
4. Support Matrix / 测试证据；
5. 历史快照与 Git history。

实现、构建、mock、manifest 或 SDK 存在都不等于真实第三方 Host/Provider 已认证。功能完成后先进入 pending-test；真实确认后再进入 features。
