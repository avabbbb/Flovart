# Flovart Agent V1 实施规划

## 产品定义

Flovart Agent 是产品内唯一面向用户的内置制作 Agent。PI 只是隐藏的 Agent Kernel，Production Skill 是可选制作方法，VOX Skill 是一个具体方法；Codex、Claude Code 与 OpenCode 是外部 Coding Agent，不是第二套内置人格。

V1 的目标不是制造一个通用 Coding Agent，而是让用户用自然语言形成可审查的制作方案，在精确预算和线路范围内启动制作，并在 Agent 与 Workflow 两个工作区中监督同一个 Runtime 任务。

## 用户主流程

1. 用户在 Agent Workspace 描述想做的作品，可附带本地素材。
2. Flovart Agent 读取当前项目、素材与 Runtime 状态，必要时推荐一个 Production Skill；没有合适 Skill 时直接使用 ProductionSpec Core。
3. 用户明确确认或拒绝 Skill 推荐，Agent 不得静默绑定或切换。
4. Agent 生成一张“制作方案”卡，默认只展示目标产物、可选 Skill、预计费用、关键审片点和执行范围；规格与线路按需展开。
5. “仅保存草稿”和“预览 Workflow”不授权执行；主按钮“确认并开始”以一次幂等操作创建 Production Mandate 并启动 ProductionRun。
6. Runtime 自动把同一 ProductionSpec Revision 投影到 Workflow；Agent 负责意图、解释和监督，Workflow 负责可视化查看与编辑。
7. 创意修改或 Skill 切换产生新 Revision 并使旧 Mandate 失效；已提交的 Run 不被原地热改。

## 权威边界

| 层 | 负责 | 明确不负责 |
|---|---|---|
| PI Agent Kernel | 对话循环、流式事件、工具调用、转向、续问、Specialist 调度 | Provider Secret、付费授权、生产状态真相、Shell、任意文件访问 |
| Agent Session Store | 主对话、探索分支、消息、工具轨迹、Specialist Report | ProductionSpec、Mandate、预算、Run、Artifact 状态 |
| Desktop Runtime | Route Mapping、Keyring、ProductionSpec Revision、Mandate、Run、费用、Gate、Artifact | Agent 人格、聊天 UI、自由文本推理 |
| Agent Workspace | 对话、方案卡、监督、待确认事项、产物入口 | 独立执行引擎、第二份 Workflow 图 |
| Workflow Workspace | Production Plan Projection、节点编辑、运行状态可视化 | ProductionSpec 权威、独立 Provider 调用 |

Node 与 Rust 不直接并发写同一个 SQLite 文件。Agent Session Store 只引用 Runtime 对象的稳定 ID；浏览器本地存储只保留空间布局与视口。

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

- 补齐 ProductionSpec Revision、Run Route Plan、Run Budget、Review Policy 到 Production Plan Card 的投影。
- 实现“仅保存草稿”“预览 Workflow”“确认并开始”三种明确动作。
- “确认并开始”使用同一个幂等键创建 Production Mandate 和 ProductionRun，网络重试不得重复提交。
- 聊天中的“可以”“继续”“开始”不得替代方案卡授权。

### E. Production Skill 与 Specialist

- Primary Skill Binding 允许零或一个；无绑定时直接使用 ProductionSpec Core。
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
- 不选择 Production Skill 也能完成从 Brief 到制作方案的通用规划。
- 选择或切换 VOX Skill 必须由用户明确确认，并产生可追踪 Revision。
- PI 进程、浏览器事件、会话库和日志中均不出现原始 Provider Secret。
- Agent Node 进程或 WebUI 重启后，主对话、当前方案和正在运行的 ProductionRun 均可恢复。
- “仅保存草稿”和“预览 Workflow”不会产生 Provider 提交；“确认并开始”重复请求只启动一次 Run。
- Agent 与 Workflow 展示同一个 Run ID、状态、预算和 Artifact，不存在两套执行真相。
- Specialist Agent 无法直接创建 Mandate、提交 Provider 或修改权威 ProductionSpec。
- Fake Model、Fake Provider 和 SQLite 重启测试进入默认测试；真实 Provider Smoke Test 继续单独请求费用批准。

## 明确非目标

- 不把 Flovart Agent 做成代码编辑器、终端 Agent 或任意网页自动化 Agent。
- 不复制 PI Coding Agent、PI TUI 或 PI Web UI。
- 不允许社区 Production Skill 注册任意工具、任意专家 Prompt 或 Provider 请求。
- 不在 V1 支持多个平级内置 Agent 共同改写一份制作计划。
- 不用一次大提交同时迁移全部 Provider、全部平台安装器和全部旧命名。

## 关联决策

- [ADR 0045：以 ProductionSpec 作为 Workflow 投影的权威](../adr/0045-make-production-spec-authoritative-over-workflow-projection.md)
- [ADR 0046：每个 ProductionSession 至多绑定一个主 Production Skill](../adr/0046-bind-at-most-one-primary-skill-per-production-session.md)
- [ADR 0051：以 Production Mandate 统一制作授权](../adr/0051-unify-production-authorization-in-a-mandate.md)
- [ADR 0052：使用一个负责的 Flovart Agent 与临时 Specialist](../adr/0052-use-one-accountable-flovart-agent-with-specialists.md)
- [ADR 0054：统一 Agent 与 Skill 语言](../adr/0054-use-one-agent-and-skill-language.md)
- [ADR 0055：每个 ProductionSession 保留一条主对话](../adr/0055-keep-one-main-agent-conversation-per-production.md)
- [ADR 0056：以内嵌 PI Agent Core 实现 Flovart Agent](../adr/0056-use-pi-agent-core-for-the-built-in-flovart-agent.md)
