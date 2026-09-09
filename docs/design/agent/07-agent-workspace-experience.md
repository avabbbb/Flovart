# Agent Workspace 体验设计

> 状态：目标设计。Agent Workspace 是外部导演 Harness 与唯一内置 Workspace Operator 之间的空间制作控制板，不是外部 Harness 的聊天镜像，也不是多 Agent 指挥中心。

## 用户心智

用户在外部 Harness 中“导演”，在 Flovart Agent Workspace 中“看制作现场”。进入 Agent Workspace 后，应在几秒内回答：

1. 当前连接的是哪个导演 Session？
2. 制作组正在做什么，卡在哪里？
3. 哪些操作改变了 Workflow/Table？
4. 哪些任务会计费或需要我确认？
5. 新产物在哪里，如何回到 Workflow/Table？

## DeepSeek Harness 主壳中的 Flovart 插件面

DeepSeek Harness 始终是用户主应用、主会话和默认导演台。RC8 Embedded Plugin 不把 Harness 反向塞进 Flovart Agent 页面，也不在 DSH 内再造一套 Flovart 产品导航；它只向原生会话的 `conversation.view` 增加一个 **Flovart Workflow** 页签。用户在 Chat 中导演，在相邻 Workflow View 中看制作组操作同一项目，切换 View 不暂停 Session、ProductionRun 或事件同步。

插件面只有两类视觉面：一个 `conversation.view` Workflow 主页面；一组 `shell.overlay` 轻弹层，用于 waiting、error、审批、任务进度与新 Artifact。插件不注册 `sidebar.footer.action`、独立窗口按钮或第二套连接入口；用户只通过 Harness 原生 View Tabs 进入 Flovart 工作页。

Table、Agent Production Control、Agent Bridge、首页、设置和 Flovart 自有左栏都不进入插件页面。它们仍可存在于独立 Flovart 产品中：Agent Bridge 继续负责跨 Harness 的显式 Handoff，但 Workflow View 只显示当前 Binding 摘要，不在 DSH 复制整套连接面或外部导航。

```text
┌────────────────┬────────────────────────────────────────────────────┐
│ DSH 原生侧栏    │ 原生 View Tabs: Chat | Flovart | Trajectory          │
│ 保持原样        │                唯一 Flovart 内部页                   │
└────────────────┴────────────────────────────────────────────────────┘
                         └─ shell.overlay: waiting / approval / Artifact
```

首版使用原生轻量边界：DeepSeek Client Plugin 直接在 DSH React 树中渲染 contextual Workflow View，不打包 Flovart React 19 主应用、Ant Design、路由或浏览器 store。Client 只通过 Harness Host 的受限同源代理读取可见 Browser Workflow，并把修改交给 `ctx.flovart` 的同一套 stable contract；Workspace Token 留在 Host，不在 URL、页面状态或节点中出现。

RC8 的根 `conversation` 与 `conversation.session` 都是排他 Slot，而 `conversation.view` 是附加列表 Slot；因此 Flovart 只注册后者，不替换主会话或其 Header/Input。若目标 Harness 版本没有相同且经过实测的 Slot 契约，就退回 CLI-only，而不是 Patch Harness 核心。可见 Browser Workflow 与 Host 同源代理是版本化兼容边界；没有可见工作区时显示明确不可用，不创建隐藏副本。

## 空间画布职责

空间画布只负责面板布局、聚焦、缩放、分组和恢复，不复制 Workflow/Table 的节点语义，也不嵌入终端或宿主完整桌面。面板数据是权威状态的 Projection；拖动面板不改变 ProductionRun、Draft 或 Director Session。

## 核心面板

| 面板 | 内容 | 主动作 |
| --- | --- | --- |
| Director Binding | Harness 类型、Session 摘要、在线状态、最后同步 | 复制连接命令、重新绑定、打开外部宿主 |
| Agent Bridge | 已发现 Host Projection 的连接、Active Director 与 Handoff 状态 | 连接、只读观察、显式交接或打开宿主 |
| Project Brief | 目标、约束、Skill、关键输入 | 回到外部导演继续修改 |
| Intent Queue | queued/running/waiting/completed Intent | 聚焦、取消、重试或查看 Receipt |
| Workspace Operator | 唯一内置执行 Agent 的当前步骤、预算与 Tool | 暂停/取消，不提供第二个自由聊天框 |
| Approval Inbox | Production Gate、外发与不可恢复请求 | 查看精确影响后批准/拒绝 |
| Change Timeline | ChangeSet、差异、冲突和撤销入口 | 聚焦 Workflow 对象、按组撤销 |
| Runtime Tasks | Task/Run/ProviderAttempt 状态 | 查看、取消、重试最小失败阶段 |
| Artifacts | 新产物、来源、验证与费用 | 打开、送往 Workflow/Table、交付 |

## 默认布局

首次进入使用低视觉重量的弹性布局：

```text
┌───────────────┬──────────────────────────┬────────────────┐
│ Director      │ Intent Queue / Crew      │ Approval Inbox │
│ Brief         │ 当前制作现场              │ Runtime Tasks  │
├───────────────┼──────────────────────────┼────────────────┤
│ Change Timeline                         │ Artifacts      │
└─────────────────────────────────────────┴────────────────┘
```

窄屏按“等待用户处理 → 当前 Intent → 产物 → 上下文”的优先级折叠。用户可以移动、缩放和保存布局，但核心状态入口不能被永久删除；被隐藏的 waiting/error 必须在全局状态栏可见。

## Director Binding 首次使用

DeepSeek Profile 首次打开 Flovart Workflow View 时，由 Node/Cordis 插件使用当前非秘密 Session ID 发起配对；用户不手填 Agent URL 或长期 Token。未绑定或从其它 Harness 独立打开 Flovart 时，不显示一个看似可用的内置聊天框，而是展示：

- Codex、WorkBuddy、DeepSeek Harness 的具名选择；
- 对所选助手可执行的准备动作与启动指令；
- 当前项目、连接阶段及失败恢复动作；
- 折叠的高级诊断；常规流程不要求填写绑定参数。

新的首次接入、WorkBuddy 技能包和创作宿主面板统一按 [本地助手接入与创作软件插件](../agent-and-creative-hosts.md) 实施。上述旧的手工 `director.bind` 引导由该方案替代，CLI 绑定命令仍可用于开发者诊断。

绑定后显示宿主和 Session 状态，但完整对话仍在外部 Harness。Flovart 可以展示 Harness 主动发布的用户可见摘要，必须标注来源和同步时间。

## Workspace Operator 节点

Workspace Operator 在画布上是一个 Tools 操作节点，而不是主聊天人格：

- 输入端：Director Intent、选择对象、附件引用、约束和预算；
- 内部：inspect → micro-plan → typed tool → observe；
- 输出端：Receipt、ChangeSet、Task/Run 句柄、Artifact 与 waiting reason；
- 展开态显示当前步骤和公开工具结果，折叠态显示状态、进度类别和待处理数量；
- 用户可以暂停、取消和查看影响，但不能在这里开启另一条长期总导演对话。

Queue、Dispatcher、Runtime Worker 和 Review Tool 只作为该节点周围的状态或工具出现，不渲染成独立 Agent 头像、人格或聊天线程。

## 状态反馈

| 状态 | UI 反馈 |
| --- | --- |
| idle | 静态、低对比，不持续呼吸 |
| inspecting/planning | 克制的 spring 扫光或脉冲，显示读取范围 |
| executing | 显示当前类型化命令、对象与 ChangeSet |
| waiting | 明确黄色入口和需要谁决定，停止持续动画 |
| failed | 错误类别、已完成步骤、费用事实和恢复动作 |
| completed/partial | Receipt 摘要、差异和产物；partial 不能使用成功绿勾掩盖 |

动效使用 `motion` spring，不写 CSS keyframes 模拟弹性，也不以持续动画代替真实状态。

## 与 Workflow/Table 的跳转

- Intent/Receipt 点击后打开对应工作区并聚焦受影响对象。
- Workflow 节点可以反查产生它的 ChangeSet、Intent 和 Director Binding。
- Table 只接收显式 Promotion/Artifact，不把 Table 节点复制进 Agent 或 Workflow 图。
- Agent Workspace 不修改 Draft 详情；编辑动作始终通过对应 Authority Port。

## 明确删除的旧交互

- 默认“Flovart Agent 主对话”。
- “添加 Codex 子任务”这种把外部主 Harness 降成子 Agent 的按钮。
- 网站 Agent / 本机 Agent 双模式切换。
- 需要用户手填本机 Agent URL/Token 的常规流程。
- 在聊天记录里寻找唯一工具历史、审批或产物状态。

## 可用性验收

- 未连接 Harness 时界面诚实显示未绑定，而不是退回内置主 Agent。
- DeepSeek Harness 保持主壳和主会话；`conversation.view` 中只有 Flovart Workflow，轻弹层和独立窗口操作的是同一 Runtime Session。
- 插件内没有第二套左栏、Table、Agent Production Control 或 Agent Bridge；独立 Flovart Agent Bridge 同时显示多个连接时仍只有一个 Active Director。
- 用户能从 waiting 面板在两次点击内看到精确影响并批准/拒绝。
- Intent、ChangeSet、Task、Artifact 可以双向定位。
- 重启 WebUI 后布局、Binding、Projection 与 Runtime 状态恢复，但不出现伪造的外部聊天历史。
- 断开 Harness 不会清空任务或产物，也不会让 Operator 自动提升为导演。
