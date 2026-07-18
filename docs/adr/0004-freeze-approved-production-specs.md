# 已批准的 ProductionSpec 不可变

ProductionSpec 在用户批准后冻结，ProductionRun 只能确定性执行该版本；Provider 轮询、下载和机械重试不改变计划。创意反馈、语义性失败或素材依赖调整必须产生 Replan Request 和新的 ProductionSpec Revision，并只重跑受影响阶段及其下游，以保留可恢复性、费用归因、产物谱系和审计能力。
