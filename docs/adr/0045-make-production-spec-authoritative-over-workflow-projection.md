# 以 ProductionSpec 作为制作计划权威

Director Skill 生成的不可变 ProductionSpec Revision 是制作计划的唯一权威，Desktop Runtime 将它编译为 ProductionRun 与 StageRun，并把 Production Plan Projection 展示到 Workflow Workspace；画布节点、连线和计划字段的有效编辑必须先校验为 Spec Patch、创建新 Revision，再重编译受影响阶段，纯布局和视口变化不修改 Spec。我们不让 ProductionSpec 与 Workflow 图双向同权，因为 Agent 修改分镜、用户操作画布和 Runtime 恢复任务时会产生无法确定的双真相，也不让 Director Skill 直接耦合具体 UI 节点版本。
