# Director Skill 共享 ProductionSpec Core

所有 Director Skill 必须输出同一套 ProductionSpec Core，使 Flovart 能统一校验、估价、监控、恢复、渲染并投影到不同创作界面。风格专属字段只能放在 `extensions.<skill-id>` 下并由 Skill 自带 Schema 校验；扩展不得注册私有执行阶段或绕开 Runtime Capability，从而兼顾跨 Skill 互操作与导演方法差异。
