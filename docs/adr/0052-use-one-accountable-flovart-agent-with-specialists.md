# 使用一个负责的 Flovart Agent 与临时专家

每个 ProductionSession 同时只有一个活跃 Flovart Agent 对制作判断、Workflow Draft 变更和方案修订负责，并保留一条可恢复的主对话。探索分支在明确提升前不能批准 ProductionSpec Revision 或请求 Production Mandate，避免多个平级对话并发改写同一制作计划。

内置 Agent 使用随 Flovart Release 固定版本的 PI Agent Core，只获得类型化工作区查询、可撤销 Draft Action、受限 Production Intent、方案修订提案和 Specialist Capability；它不获得 Shell、任意文件、原始 Provider 请求、Provider Secret，也不能代替用户批准付费或不可恢复操作。模型流经 `agent-text` Route Mapping，由当前本地执行权威注入凭据。

Workflow 操作使用 PI 的迭代工具循环：Agent 每次读取当前 Draft，经 Operation Capability Registry 调用一个类型化动作，观察提交后的 Draft/Object Version、差异或错误后再继续；一个用户回合对应一个 Draft ChangeSet。它不再依赖网站 Agent 一次生成最多若干 JSON 命令的盲执行路径。长时 Provider 任务只返回持久句柄，Runtime 与 Workspace 持续展示状态；需要授权、冲突、审片或额外输入时暂停并通过明确事件恢复，Agent 不消耗回合轮询。

Flovart Agent 可以按需请求平台登记的短生命周期 Specialist Capability，获得编剧、分镜、视觉、成本或质量等结构化建议；Specialist 不能直接修改 Workflow Draft 或 ProductionSpec、请求 Mandate 或提交 Provider。Agent 会话存储与制作 Runtime 分离，只通过稳定 ID 引用 Revision、Run、Artifact 和 ChangeSet，使会话实现变化不破坏制作真相。
