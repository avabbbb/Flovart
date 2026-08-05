# 统一制作执行、授权与状态契约

Workflow、Table、Agent、CLI 与 MCP 共享同一组类型化 Production Intent 和 Provider-neutral Capability，不各自实现 Provider 调用、费用判断或任务状态。当前项目的本地执行权威把意图展开为 ProductionRun、StageRun、ProviderAttempt 与 Artifact，并通过带幂等键的命令、可恢复任务句柄和单调事件流向各入口投影状态。

所有 Workflow/Table 结果型操作必须来自版本化 Operation Capability Registry。Registry 的执行类别、费用与确认级别决定动作是可直接执行的本地 Draft 操作，还是需要 Production Mandate 的 Provider 能力；调用方不能用任意工具名或 JSON 参数绕过 Schema、Preflight、预算和权限。

可撤销的草稿编辑和本地非 Provider 步骤不需要执行授权；任何可能计费的 Provider 提交必须由不可变 Production Mandate 授权，并精确引用 Workflow Draft 版本、ProductionSpec Revision、Authorized Operation Subgraph、Route Plan、Run Budget、输入范围与 Review Policy。用户通过一张 Production Plan Card 对精确子图一次确认，而不是逐节点弹窗或授予整场会话的开放预算；未包含的新节点不能继承授权，语义修改只使改动节点及受影响下游重新授权。System Gate 保护费用、安全、权限和运行可行性，不能由 Skill、Agent 或自动审片策略跳过。Agent Tool Approval 与 Production Gate Approval 分开记录，允许 Agent 使用工具不等于允许付费生成。

运行状态至少区分 ProductionRun、StageRun 与 ProviderAttempt。提交结果不明确时进入 `submission_unknown`，保留费用预留且禁止自动重提；重试创建新的 Attempt。状态变化和 Usage Ledger 必须可持久恢复，不能依赖 Agent、页面或 TUI 持续在线。

ProviderAttempt 与启动时 Operation Recipe Hash 永久关联。若执行期间 Draft 已修改该 Operation，晚到 Artifact 仍作为旧 Recipe 的不可变 Take 保存并完成费用对账，但不得自动成为当前选择或触发新版下游；采用旧 Take 是新的显式 Draft Action。

ProviderAttempt 还必须引用不可变 Execution Prompt Snapshot，而不是只记录 Prompt Hash 或事后读取当前节点文本。Snapshot 包含实际提交文本、引用绑定、规范化参数与编译器版本，但不保存 Provider Secret；这样 Prompt 增强和 Adapter 转换可审计，当前可编辑 Prompt 继续独立演进。

Desktop Runtime 的控制面只通过受认证的 Tauri IPC 或带轮换凭据的本机类型化接口开放，Provider Secret 不返回给 WebUI、CLI、MCP 或 Agent。纯 Web 执行沿用同一请求、授权与状态语义，但必须明确其恢复和密钥保护能力低于 Desktop Runtime。
