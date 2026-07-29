# 制作审批分为 System、Skill 和 User Gate

ProductionRun 使用三层审批门：System Gate 强制保护权限、预算、安全和运行可行性，任何 Skill 或 Review Policy 都不能跳过；Skill Gate 表达导演推荐的创作审片点；User Gate 表达本次运行的额外要求。用户在运行前选择 Guided、Balanced 或 Autonomous Review Policy 来控制 Skill Gate，使全自动制作与人工把关共用同一执行模型。
