# 使用单一负责总监与临时专家

每个 ProductionSession 同时只有一个活跃 Flovart Agent 对制作判断和计划修订负责，它可以按需委派短生命周期的 Specialist Agent 获取编剧、分镜、视觉、成本或质量建议，但专家只能返回结构化结果，不能直接修改权威 ProductionSpec、请求 Production Mandate 或提交 Provider。我们不采用多个平级总监共同写计划，因为并发决策会模糊责任、制造版本冲突并放大模型成本；也不把所有专业判断塞进一个无限增长的总监上下文。
