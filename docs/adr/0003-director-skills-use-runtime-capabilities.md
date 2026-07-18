# Director Skill 只能声明 Runtime Capability

Director Skill 负责把用户意图编译为 ProductionSpec，只能声明所需 Runtime Capability，不得持有 API Key、直接调用 Provider 或把具体模型接口当作制作协议。普通 UGC Skill 默认禁止网络与秘密访问；可选确定性脚本必须在无网络沙箱内运行，额外权限只向经过人工审核的认证发布者开放，以便 Flovart 统一执行、预算、审批、恢复和审计。
