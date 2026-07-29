# 以 Production Mandate 统一制作授权

Flovart 使用不可变的 Production Mandate 作为从免费规划进入真实 Provider 提交的唯一授权，精确引用获准执行的 ProductionSpec Revision、Run Route Plan、Run Budget、Review Policy、输入范围与审批门；任何绑定内容变化都会使旧 Mandate 失效并要求用户重新确认。用户只需通过一张 Production Plan Card 理解目标产物、可选 Skill、预计费用、关键审片点与执行范围，底层规格和线路按需展开；卡片主动作明确命名为“确认并开始”，以一次带幂等键的操作创建 Mandate 并启动对应 ProductionRun，网络重试不得重复开跑。“仅保存草稿”和“预览 Workflow”不创建授权，聊天中的自然语言同意也不视为可执行授权，以避免 Agent 修改计划后继续沿用旧预算、线路或审片责任。
