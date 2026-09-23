# Agent Skill 与外部 Agent 使用

本页描述当前 Agent Integration Skill。产品 IA 见[主设计](../design/flovart-native-effects.md)，真实 Host 状态见[支持矩阵](../../SUPPORT_MATRIX.md)。

## Agent Integration Skill 是什么

它是一份给 Codex、WorkBuddy、Claude Code 等 Coding Agent 的操作说明：告诉 Agent 如何准备 Flovart、读取当前 Workflow、应用结构化修改、运行节点并核对结果。

它不是：
- Agent 连接本身；
- Provider 账号；
- 权限授权；
- Production Skill Marketplace；
- Director / Crew / Operator 调度器。

仓库中既有 VOX / recipe / production-skill 内容可以继续作为实验方法存在，但不属于当前一级产品 IA。

## 当前外部 Agent 流程

1. 通过 `ensure` 准备 Flovart 与对应 Skill。
2. 打开并绑定真实可见 Workflow。
3. Agent 先 `status` / `workflow.inspect`，需要时读取 selection。
4. 使用 `workflow.apply` 做结构化编辑。
5. 只有在输入、目标和费用边界明确后才 `workflow.node.run`。
6. 用可见 Workflow 与 operation receipt 核对结果。

普通浏览器页面“打开了”不等于 Agent 已绑定；“已准备”也不等于第三方 Host 已登录并完成真实调用。

## 稳定命令

日常模型面：
- `status`
- `workflow.inspect`
- `workflow.selection.get`
- `workflow.apply`
- `workflow.node.run`

连接/诊断：
- `ensure`
- `doctor`

其它命令属于兼容、调试或内部 Runtime surface，不自动暴露给模型。

## CLI 与 MCP

CLI + Skill 是默认外部路径。MCP 只投影同一稳定 operation contract，不允许维护第二份 Workflow mutation 或 Provider 业务逻辑。

TeleAgent 等 MCP Host 只有完成真实客户端导入与 tracer 后才能升级支持状态。

## Agent surface 与 Assistant

顶栏 Agent 页负责 Host discovery / prepare / status / switch。

Canvas/Table 右侧 Assistant 是 Flovart 内置助手。二者不复制 Host picker、会话或 Context/History。

切换 Agent 只交接显式目标、素材与 operation result，不迁移账号、隐藏上下文或假装会话完全相同。
