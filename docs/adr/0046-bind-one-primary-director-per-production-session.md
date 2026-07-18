# 每个 ProductionSession 只绑定一个主 Director

Flovart V1 为每个 ProductionSession 固定一个 Primary Director Binding，并在 ProductionSpec Revision 中锁定精确 Skill 版本或 Skill Snapshot；通用素材、提示词参考和 Validated Profile 可以被主 Director 引用，但第二个 Director Skill 不能同时改写同一作品的叙事弧、阶段、Extension 和 Director Gate。该限制牺牲了任意多 Skill 混搭，换取可验证 Schema、可复现规划、清晰撤销和准确 Skill Eval；未来若引入组合，必须先定义显式的组合协议，而不是让 Coding Agent 临时混读多个导演包。
