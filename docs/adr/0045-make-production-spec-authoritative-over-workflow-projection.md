# 以 ProductionSpec 作为制作计划权威

Flovart Agent 生成的不可变 ProductionSpec Revision 是制作计划的唯一权威，可选 Production Skill 只为它提供声明式制作方法。用户确认 Production Plan Card 后，Desktop Runtime 将对应 Revision 编译为 ProductionRun 与 StageRun，并自动生成或刷新 Workflow Workspace 中的 Production Plan Projection；Agent Workspace 继续承载意图、对话和监督，Workflow Workspace 承载可视化查看与编辑，两者共享同一 Runtime 运行状态。画布节点、连线和计划字段的有效编辑必须先校验为 Spec Patch、创建新 Revision，再同步投影并重编译受影响阶段，纯布局和视口变化不修改 Spec。我们不让 Agent 与 Workflow 各自持有一套执行真相，也不让 ProductionSpec 与 Workflow 图双向同权，因为 Agent 修改分镜、用户操作画布和 Runtime 恢复任务时会产生无法确定的双真相。
