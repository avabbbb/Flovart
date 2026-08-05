# 统一 Production Skill 契约与包边界

Flovart 只使用两类 Skill 语言：操作 Skill 指导外部 Agent 如何通过 CLI/MCP 操作 Flovart；Production Skill 是内置 Flovart Agent 可加载的制作方法。操作 Skill 不编译制作计划，Production Skill 不直接操作 Workspace、持有 Provider Secret 或提交 Provider 请求。

所有 Production Skill 输出共享的 ProductionSpec Core，只能声明 Runtime Capability Requirement、Skill Gate 与 `extensions.<skill-id>` 下的受 Schema 校验扩展。一个 ProductionSession 可以不绑定 Production Skill，但最多绑定一个精确版本或本地 Snapshot；切换绑定必须产生新的 Workflow Draft 与 ProductionSpec Revision，不能让多个 Skill 并发改写同一制作计划。

Production Skill Package 使用精炼 `SKILL.md` 与 `flovart.skill.yaml` 声明身份、版本、兼容性、权限、Capability、Gate、扩展 Schema 和 Eval。公开版本不可变并以版本与 Hash 锁定；社区分发前完成静态校验、零费用 dry-run、许可证与基础评测，撤销只作用于精确版本。确定性脚本必须声明输入输出且默认无网络、无秘密、不得调用任意外部二进制；Skill Authoring 与正常 Production Workspace 保持隔离。
