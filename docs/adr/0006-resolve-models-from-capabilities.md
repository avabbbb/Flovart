# 从 Capability Requirement 解析模型

Production Skill 不得强制绑定 Provider 或模型，ProductionSpec 只声明 Capability Requirement。Skill 版本可以发布带评测分数的 Validated Profile；Runtime 按本次运行显式选择、项目 Model Preference、Validated Profile、Compatible Route 的顺序解析模型，并记录解析理由与是否发生兼容降级，使风格经验可复用而不破坏 Provider 所有权和模型可替换性。
