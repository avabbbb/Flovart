# 迁移与验收

> 状态：实施规划。文档重构不等于代码迁移完成；所有产品声明以本文件的放行门为准。

## 当前代码事实

| 当前路径 | 事实 | 与目标的冲突 |
| --- | --- | --- |
| `components/agent/AgentWorkspace.tsx` | 默认渲染 `FlovartAgentPanel`，Codex 作为“子任务” | 主次颠倒；目标只保留可由 Flovart Dock 打开的 Production Control |
| `components/agent/agentWorkspaceStore.ts` | 固定 `flovart-main` 面板并迁移旧 `codex-main` | UI 数据模型仍以内置主 Agent 为中心 |
| `agent/flovart.js` + `agent/kernel.js` | 旧内置主 Agent 通过 `@earendil-works/pi-agent-core` 创建长期会话并写 SQLite | Operator 应按 Intent 临时运行；实现包名不再成为产品角色名 |
| `services/browserAgentKernel.ts` | 浏览器再实现一套旧内置 Agent、会话和直连模型 | 双内核、双会话、Secret 边界不同 |
| `components/agent/FlovartAgentPanel.tsx` | 在 Managed/Browser 两个旧内置实现间切换 | 不应再提供内置主聊天 |
| `components/workflow/WorkflowAgentPanel.tsx` | 网站/本机双模式，默认网站路径 | 仍有第二套 Agent 产品语义 |
| `services/workflowOnlineAgent.ts` | 一次生成 JSON 命令批次 | 不观察逐步真实结果 |
| `agent/codex.js` | Flovart 主动启动 `codex app-server` | 宿主私有且生命周期方向相反 |
| `agent/mcp.js` 与发行包中的 `managed-agent/mcp.js` | 旧 Managed/Codex 适配器仍可启动内部 MCP transport | 不再作为正式外部接入面；迁移后删除 |
| `agent/index.js` | `/agent/flovart/*` 与 `/agent/codex/*` 并存 | 没有统一 Crew/Protocol 语义 |
| `tools/flovart/cli.js` / `agent-kit.js` | CLI 仍保留少量兼容启动参数 | 新入口只启动 Flovart 服务；Coding Agent 由 Host Projection 独立连接 |

当前已经值得保留的基础包括 Canonical Command Registry、Workflow Dispatcher、Draft ChangeSet/Object Version、Operation Registry、Runtime Task/Event、Artifact、CLI JSON 输出、Skill CLI 和 loopback 安全控制面。

## 迁移原则

- 先建立新协议和数据权威，再切 UI；不先改名字制造假完成。
- 不给旧路径增加新能力；新 Crew Intent 只接统一 Registry/Authority。
- 项目尚未上线，不写旧内置聊天兼容、双写或自动迁移层。
- 每个切片都用一个真实可见 Workflow 变更证明，不以静态组件或单元测试冒充完成。
- 保留现有用户工作区改动；迁移只改明确列出的 Agent 文件。
- 对外始终只呈现两个 AI 角色：External Director Harness 与 Workspace Operator；Production Crew、Runtime、Worker 和 Review Tool 不增加 Agent 数量。
- Pi Coding Agent Harness 是外部导演宿主；`pi-agent-core` 只是当前代码依赖，二者不得共用“PI 主 Agent”产品语言。
- Agent Identity、IDE Host、Distribution Target、Runtime Surface 与 Director Runtime Binding 必须分开；WorkBuddy 是未来 mainstream、skill-mediated projection 候选，不是当前 Coding Agent Director Host。

## S0：契约与术语

- 新 ADR 接受“External Director Harness + Workspace Operator”两个 AI 角色；Production Crew 明确为执行组件集合。
- [`CONTEXT.md`](../../maintenance/agent/CONTEXT.md) 移除内置主 Agent、Managed/Connected 双主语言。
- 当前 professional golden path 是 Codex；DeepSeek Harness 保留显式 native Plugin projection；CodeBuddy Code、Claude Code、OpenCode、Pi 通过 stable Skill + CLI contract 兼容；WorkBuddy 后续单独评估，不进入本轮 Director Binding。
- Canonical Registry 设计 `director.*`、`crew.intent.*`、`crew.receipt.*` 与事件 Schema。
- 固定模型工具的 Operation Skill + CLI 公开边界；DeepSeek 私有 UI/事件通道只存在于可卸载 Embedded Plugin，MCP Server 不恢复。
- 为每个目标命令写 Contract Test，再进入实现。

放行门：设计文档、ADR、CONTEXT、todo、公开功能边界之间没有相反定义。

## S1：最小 Crew Intent tracer bullet

只实现一个 Intent：读取当前 Workflow 选择，把三张图片创建为并行分支并返回 ChangeSet/Receipt。

- 新建持久 Intent/Receipt 状态；
- 把现有内置 Kernel 收缩为单 Intent 生命周期；可复用 `pi-agent-core`，但产品角色统一称 Workspace Operator；
- 只注册 inspect/create/connect/layout 等 draft-only Capability；
- 每步观察 Draft/Object Version；
- 覆盖 completed、partial、conflict、cancelled 和重启恢复；
- 不含 Provider、Review Tool、外部通信或额外 Agent。

放行门：关闭 Operator 进程后从 Intent/ChangeSet 恢复；没有长期主聊天数据库。

## S2：CLI 与内部协议

- CLI 通过统一 Local Control Protocol 调用 Crew/Workspace/Runtime；
- 实现版本握手、Registry Hash、幂等冲突、JSONL 事件游标与按 Intent 取消；
- `flovart start` 不再拉起/回收外部 Coding Agent；
- `init --target` 只安装对应 Distribution Target 的 Operation Skill/连接说明，不创建 MCP 配置；`host.list` 只做 PATH discovery，不读取 auth/API Key；
- 更新 Toolkit manifest，固定 Production Crew 所需 Node/Operator Kernel 版本；
- Source Development 可以使用受约束系统 Node，正式发行必须捆绑或明确安装依赖。

放行门：Codex 用 Operation Skill + CLI 完成当前 professional tracer bullet；DeepSeek Harness 验证显式 native Plugin 边界；其它 Coding Agent 通过同一 stable CLI contract 保持兼容。关闭 Flovart 不终止宿主，关闭宿主不终止 Runtime Task；WorkBuddy 不属于本阶段放行门。

## S3：会话反转与 Agent Workspace

- 增加 Director Session Binding、Director Session Projection 和 Director Handoff Snapshot；
- Director Session Binding 在 ProductionSession 与外部 Harness Session 两端都保持一对一活动关系，项目切换必须显式 Handoff；
- 先为 Codex 与 DeepSeek Harness 实现和实测深度 Session Binding、事件投影与可选 Connector；其它 Coding Agent 的结构化会话/事件面按需接入，不能反向污染稳定 CLI contract；
- Agent Workspace 默认展示 Binding、Intent Queue、Crew、Approval、Timeline、Task 和 Artifact；
- DeepSeek Profile 中的 Agent Bridge 默认绑定当前 DeepSeek Session，其它 Harness 只在显式 Handoff 后获得导演写权；
- 删除默认 `Flovart Agent` 聊天与“Codex 子任务”命名；
- 未绑定 Harness 时显示连接命令和只读任务状态，不回退内置聊天；
- Agent Workspace 布局继续使用 localforage，只保存布局/Projection cache。

放行门：Codex 与 DeepSeek Harness 先通过真实 Session 重启、Flovart 重启、双方重启三种深度恢复路径；Claude Code、OpenCode、Pi 的 CLI 基线不因第二批 Connector 尚未完成而降级或阻塞，且任何宿主都没有完整聊天镜像。

## S3B：DeepSeek Harness Flovart Dock Profile

- 发布独立 Flovart DeepSeek Profile，不修改用户已有 `web`/`headless` profile，也不 Fork Harness；
- Host Plugin 从 Registry 派生渐进式工具面并通过 CLI 执行，Client Plugin 通过短期配对的 Local Control Protocol Client 挂载 UI、事件与恢复；
- DeepSeek Harness 保持原生主壳、主会话和默认导演权；Client Plugin 注册左侧固定 Flovart Dock，中央 Workspace Surface 打开完整 Workflow/Table/Agent Production Control，轻量弹层处理审批/状态/Artifact，并支持全屏和独立窗口降级；
- 右侧 Agent Bridge 显示已发现的 Host Projection 和 Active Director，多个宿主可以连接但不能并行获得导演写权，切换必须显式 Handoff；
- 不把 DeepSeek Harness 反向嵌入 Flovart Agent 页面，不复制聊天，也不 Patch developer-preview Harness 核心；缺少稳定导航/Workspace 插槽的版本只允许工具栏入口或独立窗口降级；
- 首次缺少 Runtime 时展示版本、来源、体积、完整性和权限，用户确认后复用 Agent Bootstrapper 安装 Runtime Release Bundle；
- Profile、Embedded Plugin、Harness 与 Runtime 协议按已验证兼容集发布，升级需用户确认、原子切换并可回滚；
- Harness 重载/崩溃不终止 ProductionRun，恢复后按 Binding 与事件游标重连；
- Tool Approval 与 Production Gate 在同一窗口明确分层，不能相互继承。

放行门：在全新机器、已有兼容 Runtime、已有不兼容 Runtime 三种环境完成 `dsh --profile flovart` 真实安装/启动；覆盖固定 Dock、中央完整工作区、快速审批弹层、独立窗口、Agent Bridge 单导演交接、项目 A→B 显式 Handoff、Harness 崩溃后任务继续、Profile/Plugin 禁用后 CLI-only 降级、失败升级回滚和两层审批，不以静态组件挂载或 mock 事件冒充完成。

## S4：Production 与安全闭环

- Crew Intent 可创建 pending Provider Operation，但付费提交必须经过 Production Plan Card/Gate；
- Intent 完成后 Runtime Task 独立运行，事件驱动更新 Receipt/Projection；
- 支持外部通信前先实现 Communication Capability、目标白名单和内容确认；
- Toolkit Plugin 增加完整性、权限和隔离；Production Skill 仍不可执行代码；
- 做 Secret、路径、Prompt injection、submission unknown 和费用事实测试。

放行门：真实 Provider Smoke Test 单独经用户费用批准；断流和取消不会伪造未计费或已取消。

## S5：删除旧路径

满足前述门槛后直接删除，不保留旧数据兼容：

- 浏览器长期 `BrowserAgentKernel` 主会话；
- Node `agent-sessions.db` 主对话依赖；
- `FlovartAgentPanel` 主聊天产品语义；
- `WorkflowAgentPanel` 网站/本机双模式；
- `workflowOnlineAgent` one-shot JSON 主路径；
- Flovart 主动管理 Codex app-server 的核心依赖；
- 旧 Managed/Codex 适配器中的 MCP transport 与 `source: mcp` 产品语义；
- `/agent/flovart/*`、`/agent/codex/*` 旧双 Route；
- Managed/Connected Agent 产品分级与相关启动文案；
- 任何 MCP Server、shadow runtime、file queue 或私有 HTTP 回退。

宿主特有 Connector 如仍有价值，迁到对应外部 Harness 的可卸载宿主插件；它不是 Flovart Toolkit Plugin，也不是共同 CLI 基线。

## 测试矩阵

| 层 | 必须验证 |
| --- | --- |
| Contract | Command/Intent/Receipt/Event Schema、版本握手、Registry Hash |
| Kernel | 工具预算、冲突重读、partial、cancel、临时上下文销毁 |
| Workspace | 同一 ChangeSet、对象版本、撤销、布局、不覆盖人工修改 |
| Runtime | Task/Run 恢复、Gate、费用、Artifact、submission unknown |
| CLI | PowerShell/zsh/bash JSON、安全退出码、JSONL 游标、无 MCP |
| Desktop | 随机 loopback、Token/Origin、重启、正式 Node Runtime |
| UI | Binding/Intent/Receipt/Approval/Artifact 双向定位与响应式布局 |
| Browser | 无本地 Operator 时诚实不可用，不启动第二套内置主 Agent |
| Security | Secret/路径脱敏、恶意 Skill、越权命令、外发确认 |
| Host Projection baseline | Codex 完成 professional golden path；DSH 完成显式 native Plugin 边界；其它 Coding Agent 通过 Operation Skill + CLI contract 保持兼容 |
| Deep connectors | Codex、DeepSeek Harness 的 Session Binding、事件游标、断线与恢复先完成；其 Connector 故障不影响 CLI 基线 |
| DeepSeek Profile | 专用 Profile 安装、固定 Flovart Dock、中央隔离 Workspace、快速弹层、独立窗口、Agent Bridge 单导演交接、任务存活、兼容集升级/回滚和 CLI-only 降级 |

## 完成定义

只有同时满足以下条件，才能宣称新的 Agent 架构完成：

1. 产品只呈现 External Director Harness 与 Workspace Operator 两个 AI 角色；用户主对话只存在于外部 Harness，Flovart 无内置主聊天回退。
2. Workspace Operator 是唯一内置执行 Agent，只在一个有界 Intent 内微规划；Production Crew 的其余组件全部是 Tool/Service，不能修改导演主计划。
3. Codex 通过 Operation Skill + CLI 完成当前完整产品路径；DeepSeek Harness 保持显式 native Plugin projection；其它 Coding Agent 通过同一 CLI contract 兼容，仓库没有 Coding Agent MCP Server。WorkBuddy 不在当前 Director Binding 放行范围内。
4. CLI、WebUI、Operator 共享版本化协议与 Canonical Registry。
5. Agent Workspace 是制作控制板，能恢复 Binding、Intent、Receipt、Task 和 Artifact。
6. 付费/发布/外发/不可恢复操作由 Flovart Gate 强制，宿主 Tool Approval 不可替代。
7. 当前代码表中的旧主路径全部删除或降为明确可卸载 Connector Plugin。
8. Typecheck、定向测试、构建、真实 Desktop/CLI/Harness 路径和失败可见性全部通过。
9. DeepSeek Harness 插件体验只有在专用 Profile 的首次安装、Harness 主壳内固定 Flovart Dock、中央完整工作区、快速弹层、独立窗口、Agent Bridge 单导演 Handoff、真实任务存活、兼容集回滚和 CLI-only 降级全部通过后才能宣称交付。

在这些条件之前，公开文档只能写“目标设计/迁移中”，不能把新的导演台/制作组架构描述成已交付功能。
