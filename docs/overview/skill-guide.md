# Skill 与 Agent 使用

本页描述当前可用入口；[原生效果与 Agent 双入口](../design/flovart-native-effects.md)仍在开发。各助手的真实验证状态见[支持矩阵](../../SUPPORT_MATRIX.md)。

## 两类内容

- Operation Skill：教 Codex、WorkBuddy 等助手检查 Flovart、操作当前项目并核对结果。
- Production Skill：提供制作方法、输入要求、参考流程与验收标准，例如已有 VOX 方法。

Skill 不等于连接成功，也不代替 Provider、费用授权或执行器。不要求任务必须经过一个额外的内置 Operator。

## 当前外部助手流程

1. 按[快速开始](quick-start.md)安装并准备当前助手的 Flovart Skill。
2. 打开并绑定真实可见 Workflow；普通网页地址本身不代表已绑定。
3. 在助手中提出具体任务，例如：

   > 使用 Flovart，读取当前 Workflow 和选区，把这些参考图组织成三个生成分支。先准备草稿，不开始付费生成。

4. 在 Workflow 中检查真实变化；需要生成时确认输入与本次费用。Agent 的成功文字必须有对应操作回执和可见结果。

指定已有方法时可以说：

> 使用 $vox-director，根据这篇文章准备一条中文解释短片的节拍与参考图，先让我确认视觉方向。

安装 Skill、选择方法和查看草稿都不能自动触发远程生成。主工作区入口、登录和恢复以当前安装版本为准，不要求用户手填 Token、端口或 Session ID。

## 当前命令边界

日常 Agent 使用 status、workflow.inspect、workflow.selection.get、workflow.apply、workflow.node.run；ensure 负责连接准备。command.list/schema 仅作 discovery、兼容诊断或调试，完整已实现命令见[Workflow CLI](../../skills/flovart/commands/workflow.md)。

当前没有 Table 自动化和原生效果工具的完成声明。MCP 已作为可选 stdio transport 交付，只暴露与稳定 Agent surface 对齐的五个工具；TeleAgent 的真实导入和客户端行为仍需按支持矩阵认证。

## 后续双入口

用户可继续在原助手操作，也可在 Flovart 内发任务并查看受支持助手的用户可见消息和结果。Codex 深度接入按 app-server 验证；WorkBuddy 双向按官方应用/本地助理 API 验证。两端调用同一业务能力，不能维护两份生成任务。

切换助手交接目标、素材与任务结果，不迁移账号、隐藏上下文或假装会话完全相同。PS/PR/AE 插件与原生效果的首次闭环以主设计为准，未通过真实宿主前保持开发中。
