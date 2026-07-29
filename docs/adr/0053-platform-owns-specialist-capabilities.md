# 由平台拥有 Specialist Capability

Flovart 通过平台注册表定义 Specialist Capability，为每项专业判断固定任务语义、输入输出 Schema、工具上限与成本观测边界；Flovart Agent 和 Production Skill 只能请求已注册能力，Skill 可以补充风格上下文，但不能创建任意专家 Prompt、扩大工具面或直接选择秘密 Provider 凭据。Skill 通过 Specialist Review Gate 声明 required 或 recommended 审查，并由 Review Policy 决定实际执行强度，而不是每次运行全部专家或让总监不可预测地自由选择。这样社区 Skill 仍能组合叙事、镜头、证据和视觉连续性能力，同时平台可以对相同契约做权限审查、兼容性校验和可重复评测，代价是新增专家类型必须经过平台版本发布。
