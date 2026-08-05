# Flovart Agent V1 实施规划

## 产品定义

Flovart Agent 是产品内唯一面向用户的内置制作 Agent。PI 只是隐藏的 Agent Kernel，Production Skill 是可选制作方法，VOX Skill 是一个具体方法；Codex、Claude Code 与 OpenCode 是外部 Coding Agent，不是第二套内置人格。

V1 的目标不是制造一个通用 Coding Agent，而是让用户用自然语言直接形成并修改可见的 Workflow Draft，在画布上检查节点、连线、提示词、参考和工具步骤，批准后再于精确预算和线路范围内启动制作，并在 Agent 与 Workflow 两个工作区中监督同一个 Runtime 任务。

## 用户主流程

1. 用户从 Agent Workspace 或 Workflow 中的 Agent 入口描述想做的作品，可附带本地素材或直接选中画布节点。
2. Flovart Agent 读取当前 Workflow Draft、项目素材与 Runtime 状态，必要时推荐一个 Production Skill；没有合适 Skill 时直接使用 ProductionSpec Core。
3. 用户明确确认或拒绝 Skill 推荐，Agent 不得静默绑定或切换。
4. Agent 通过与人工编辑共用的 Workflow Draft Action 直接创建或修改节点、连线、Operation Prompt Document、参考、模型参数和二次处理步骤；现有 PromptBar 编辑同一权威文档，不增加第二套 Prompt 表面。所有结果型处理形成输入媒体 → Workflow Operation Node → 输出媒体，操作配方可折叠但可展开编辑；可撤销动作耐久提交并立即出现在画布，一个 Agent 回合归入同一语义 Draft ChangeSet，部分失败时保留成功步骤与可重试失败节点。
5. Production Plan Card 从当前 Workflow Draft 与待执行 Operation 子图生成执行摘要，默认展示目标产物、节点范围、可选 Skill、预计费用、关键审片点和执行范围；配方、依赖与线路按需展开。
6. “仅保存草稿”和“预览执行计划”不授权执行；付费生成、冻结 Revision、发布或不可恢复动作仍需明确 Gate。主按钮“确认并开始”冻结当前草稿为 ProductionSpec Revision，并以一次幂等操作创建只覆盖精确 Authorized Operation Subgraph 的 Production Mandate 与 ProductionRun。
7. Runtime 把该 Revision 的 StageRun、Artifact、费用和审批状态投影回 Workflow；运行中创意修改或 Skill 切换先派生新 Workflow Draft，重新批准后创建新 Revision，已提交的 Run 不被原地热改。

## 权威边界

| 层 | 负责 | 明确不负责 |
|---|---|---|
| PI Agent Kernel | 对话循环、流式事件、工具调用、转向、续问、Specialist 调度 | Provider Secret、付费授权、生产状态真相、Shell、任意文件访问 |
| Agent Session Store | 主对话、探索分支、消息、工具轨迹、Specialist Report | ProductionSpec、Mandate、预算、Run、Artifact 状态 |
| Desktop Runtime | Route Mapping、Keyring、获批 ProductionSpec Revision、Mandate、Run、费用、Gate、Artifact | 编辑中的 Workflow Draft、Agent 人格、聊天 UI、自由文本推理 |
| Agent Workspace | 对话、画布动作请求、方案卡、监督、待确认事项、产物入口 | 独立执行引擎、第二份 Workflow Draft |
| Workflow Workspace | 编辑阶段的 Workflow Draft、获批后的 Production Plan Projection、节点细修与运行状态可视化 | 绕过批准修改 ProductionSpec、独立 Provider 调用 |

Node 与 Rust 不直接并发写同一个 SQLite 文件。Agent Session Store 只引用 Runtime 对象的稳定 ID；每个 Workflow Project 绑定一个 Workflow Draft Authority：纯 Web 项目由 Browser Workspace/localforage 保存，Desktop 或已配对 Web 项目由 Local Data Service 保存。切换必须显式转移，浏览器与 Runtime 不双写、不静默合并。

Workflow Draft 历史不只保存无法解释的整图快照，也不把每个按键和指针事件永久化。Draft ChangeSet 记录操作者、意图、类型化动作、前后差异和结果，并可关联 Provider Task 与 Artifact；检查点只用于加速恢复。

## PI 接入方式

- 在现有 Managed Agent Node 进程内直接使用固定版本的 `@earendil-works/pi-agent-core`。
- 使用 PI `Agent` 类和受等待的事件订阅，不使用低层只观察 loop 作为持久化边界。
- 用自定义 `streamFn` 调用 Runtime 的 `agent-text` 流式接口；Runtime 按 Route Mapping 选路并从系统 Keyring 注入凭据。
- 通过 `beforeToolCall` 再校验工具类别和 ProductionSession 范围；Runtime 仍执行最终 Schema、权限、预算和状态校验。
- 只注册 Flovart 类型化查询、方案修订提案、Production Intent 与 Specialist Capability。
- 不引入 PI Coding Agent 的 Shell/读写文件工具，不采用 PI Web UI，不采用 PI 自有登录作为 Flovart 模型配置。
- PI、Agent Node Runtime、Agent Session Schema 与 Agent 协议版本在 Flovart Release Manifest 中精确锁定并一起回退。

## V1 施工切片

### A. Agent Kernel 契约

- 增加 PI Agent Kernel 适配层、类型化事件和可替换 `streamFn`。
- 用 Fake Model 验证多轮对话、工具调用、取消、steer、follow-up 和错误映射。
- 接入 PI SQLite 会话库，验证主对话恢复和探索分支隔离。
- 保留现有 Codex Adapter，但从内置 Agent 路径中解耦。
- Workflow 回合使用读取 Draft → 调用 Registry 工具 → 观察新对象版本/结果 → 继续的迭代循环；一个回合归入一个 ChangeSet，替换网站 Agent 的 one-shot JSON 命令批次。
- 长时 Provider 工具返回持久任务句柄后结束当前等待；Runtime/Workspace 观察状态，只有授权、冲突或 Intervention Event 恢复 Agent。

### B. 安全的 `agent-text` 路线

- 把 `agent-text` Route Mapping 和非秘密 Route 元数据同步为 Runtime 可查询配置。
- 增加 Runtime 流式推理接口和至少一条已验证的 OpenAI-compatible 代表线路。
- Node 只提交裁剪后的消息、系统提示和工具 Schema，不提交 `credentialRef`、Base URL、Provider 或 API Key；Runtime 按已同步路线选路后才能读取 Keyring Secret。
- 增加断流、取消、超时、未知提交状态、脱敏日志和 Route Contract Test。

### C. 第一方 Agent Workspace

- 主面板从 Codex 制作线程改为 Flovart Agent 主对话。
- 保留一条主对话并支持探索分支；分支提升前不能生成正式 Revision 或 Mandate。
- 消息、工具状态、任务状态和 Artifact 使用同一事件映射，重启后可恢复。
- Codex 等外部 Agent 只作为独立接入能力展示，不再占据默认主面板。

### D. 制作方案与授权

- 从当前 Workflow Draft 生成 ProductionSpec Revision、Run Route Plan、Run Budget 与 Review Policy 的 Production Plan Card 摘要。
- 实现“仅保存草稿”“预览 Workflow”“确认并开始”三种明确动作。
- “确认并开始”使用同一个幂等键创建 Production Mandate 和 ProductionRun，网络重试不得重复提交。
- Mandate 锁定 Draft 版本、Operation 节点与依赖闭包、Recipe Hash、Route Plan 和预算；新增节点不继承授权，语义修改只使受影响子图重新确认。
- 聊天中的“可以”“继续”“开始”不得替代方案卡授权。

### D1. AI 原生图片 tracer bullet

- 只先注册 `image.generate@1`、`image.crop@1` 与 `image.upscale@1`，从同一 Registry 生成 Agent/UI/校验契约。
- 贯通显式 Operation Node、Prompt Document、Input Binding、Execution Prompt Snapshot、Take 与 Draft Change Timeline。
- crop 作为本地可撤销动作直接运行；generate/upscale 按精确 Operation 子图一次授权。
- 覆盖 Agent 与人工共用动作、partial ChangeSet、对象版本冲突、旧 Recipe 晚到结果、按组撤销与页面重载恢复。
- 本切片不迁移视频、音频、Table Promotion 或所有旧图片工具，也不把这些能力写成已完成。
- 首个 Adapter 使用 Browser Workspace/localforage，但 UI、Agent、Dispatcher 与 Timeline 只能通过 Workflow Draft Authority Port 访问；Zustand 仅作 UI projection/cache，不增加 Runtime 双写。

### E. Production Skill 与 Specialist

- Bound Production Skill 允许零或一个；无绑定时直接使用 ProductionSpec Core。
- Skill 推荐必须展示对风格、阶段和审片的影响并由用户确认。
- 注册 narrative-review、shot-plan-review、evidence-review、visual-continuity-review 四种 Specialist Capability。
- Specialist 只返回 Specialist Report；Flovart Agent 采纳后才能形成 Spec Patch。
- Skill 切换通过显式重新规划产生新 Revision，废止旧 Mandate 与未完成审查。

### F. 分发与升级

- Desktop Edition 与 Runtime Release Bundle 捆绑受校验的 Agent Node Runtime。
- 正式安装不读取系统 `node`；Source Development Mode 可以使用满足版本约束的开发 Node。
- Release Manifest 同时锁定 Node、PI、Agent 协议和会话 Schema。
- 升级前完成会话迁移备份；失败时回退 Node、PI 和 Schema，而不是只回退其中一个包。

## V1 验收标准

- 默认 Agent Workspace 只出现 Flovart Agent，不再让用户选择多个“总监”或把 Codex 当成内置 Agent。
- Flovart Agent 的节点、连线、Prompt、参考和工具操作实时写入当前 Workflow Draft，并在画布和工具历史中可见；结果型工具具有保存完整配方的 Operation Node，设计师可以展开、修改、重跑、撤销和继续编辑。
- 每个结果型 Operation 只有一份结构化 Prompt Document；现有 PromptBar 与 Agent 修改同一数据，`@` 引用按稳定对象 ID、角色和顺序恢复，输出媒体不复制 Prompt。
- PromptBar `@` chip 与画布输入边使用同一 Operation Input Binding；角色、顺序和稳定来源 ID 从任一入口修改都会同步，不再维护多套引用数组。
- 每次 ProviderAttempt/Take 冻结实际 Execution Prompt Snapshot；增强、翻译与适配差异可查看但不覆盖 PromptBar，明确采用时才生成新 Draft Action。
- 一个 Agent 回合或连续人工手势形成一个可读 Draft ChangeSet，可查看差异、关联产物并按组撤销。
- Agent 回合部分失败时 ChangeSet 标为 `partial`；成功步骤和 Artifact 保留，失败 Operation Node 显示 Recipe、错误、费用状态与重试入口，不只在聊天中报告。
- Draft Action 携带对象期望版本；设计师与 Agent 可并行改不同节点，同对象冲突拒绝旧 Agent 动作并只重算相关子图，不锁定整张画布或最后写入覆盖。
- Operation 运行中被修改后，旧 Recipe 的晚到结果保存为标记清楚的 Take，不自动替换当前选择或触发下游；用户可以比较并明确采用。
- Workflow Workspace 提供与画布双向定位的 Draft Change Timeline；聊天只链接 ChangeSet，设计师可从回合查看差异/撤销，也可从节点追溯来源修改。
- Agent 创建节点只提交相对 Layout Intent，前端按真实尺寸找空位；人工拖动的 pinned 节点永不被 Agent 重排，布局变化不影响 Recipe Hash 或授权。
- Agent tools、WorkflowNodeToolbar、Dispatcher、Preflight 和参数控件从同一 Operation Capability Registry 派生；未注册操作与任意 JSON/HTTP/脚本不能执行。
- Flovart Agent 每步观察真实 Draft 结果再继续，支持取消/steer/冲突重读；旧网站 one-shot Agent 不保留为第二套主操作路径。
- 可撤销 Workflow Draft Action 默认直接执行；Provider 付费提交、冻结 Revision、发布和不可恢复动作必须显式确认。
- 不选择 Production Skill 也能完成从 Brief 到制作方案的通用规划。
- 选择或切换 VOX Skill 必须由用户明确确认，并产生可追踪 Revision。
- PI 进程、浏览器事件、会话库和日志中均不出现原始 Provider Secret。
- Agent Node 进程或 WebUI 重启后，主对话、当前方案和正在运行的 ProductionRun 均可恢复。
- “仅保存草稿”和“预览 Workflow”不会产生 Provider 提交；“确认并开始”重复请求只启动一次 Run。
- 多个付费 Operation 通过一张方案卡按精确子图一次授权，不逐节点弹窗，也不授予后续整场会话开放预算。
- 批准前 Agent 与 Workflow 操作同一 Workflow Draft；批准后 Agent 与 Workflow 展示同一个 Revision、Run ID、状态、预算和 Artifact，不存在两套编辑或执行真相。
- 纯 Web 与 Desktop 项目复用相同 Draft Action 契约；每个项目只有一个 Workflow Draft Authority，关闭页面后 Desktop Agent 仍可通过 Local Data Service 继续操作已绑定草稿。
- Specialist Agent 无法直接创建 Mandate、提交 Provider 或修改权威 ProductionSpec。
- Fake Model、Fake Provider 和 SQLite 重启测试进入默认测试；真实 Provider Smoke Test 继续单独请求费用批准。
- 图片 tracer bullet 能从 Agent/PromptBar 建图，经本地 crop 与付费 generate/upscale 得到可追溯 Take，并在页面重载后继续编辑；没有仅上传后端结果的旁路。
- Browser-first 模式明确提示页面关闭后 Agent 不再编辑草稿；Desktop Adapter 未完成前不宣称后台可操作，也不偷偷双写 Runtime。

## 明确非目标

- 不把 Flovart Agent 做成代码编辑器、终端 Agent 或任意网页自动化 Agent。
- 不复制 PI Coding Agent、PI TUI 或 PI Web UI。
- 不允许社区 Production Skill 注册任意工具、任意专家 Prompt 或 Provider 请求。
- 不在 V1 支持多个平级内置 Agent 共同改写一份制作计划。
- 不用一次大提交同时迁移全部 Provider、全部平台安装器和全部旧命名。

## 关联决策

- [ADR 0058：以 AI 原生 Workflow Draft 驱动画布](../adr/0058-use-ai-native-workflow-draft.md)
- [ADR 0023：统一制作执行、授权与状态契约](../adr/0023-centralize-production-execution-contract.md)
- [ADR 0025：统一 Production Skill 契约与包边界](../adr/0025-standardize-production-skill-packages.md)
- [ADR 0052：使用一个负责的 Flovart Agent 与临时 Specialist](../adr/0052-use-one-accountable-flovart-agent-with-specialists.md)
- [ADR 0042：区分内置、Managed 与 Connected Agent](../adr/0042-separate-managed-and-connected-agent-support.md)
- [ADR 0039：分离 Workflow、Table 与 Agent 工作区](../adr/0039-separate-workflow-table-and-agent-workspaces.md)
