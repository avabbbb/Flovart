# Workflow 修改校验目标、版本与幂等身份

用户和 Agent 的结构化 Workflow 修改使用明确 projectId、expectedRevision 与 mutationId，沿用当前 mutation 实现及其项目存储。相同身份/载荷重试返回原结果，不再次改图；相同身份不同载荷拒绝，旧版本冲突要求重读。

不额外创建第二份 Runtime/DSH mutation 记录来竞争工作区状态。新效果参数由宿主保存和撤销，不能直接套用 Workflow 图的存储模型；共享的是明确目标、重试不重复执行的行为原则。
