# 以统一 Route Mapping 取代 Model Preference

Flovart 删除全局 LLM、图片和视频 Model Preference 以及依据 API Key 健康状态自动改写偏好的逻辑，把媒体的 Product Model + Generation Mode 和提示词增强、脚本拆解、Agent 文本生成等 Runtime Capability 都建模为类型化 Route Mapping Target，并在同一个“模型映射”中心绑定主 Provider Route 与有序备用线路；PromptBar 只表达产品模型和生成模式等创作意图，Route Mapping 是 Workflow、Table 与 Agent 提交前选路的唯一用户配置来源，系统建议只能等待用户确认后生效，主线路在提交前不可用时可以预选下一条可用线路但必须展示变更并再次确认，ProviderAttempt 开始后不得自动切换，从而避免隐藏默认值、重复设置、意外切换和不可控的重复计费，但需要统一改造现有调用方与持久化结构。
