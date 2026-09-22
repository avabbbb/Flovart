# Flovart 文档索引

## Current truth：只读这 7 份

1. [AGENTS.md](../AGENTS.md) — 开发约束、当前 IA、文档治理。
2. [产品与系统主设计](design/flovart-native-effects.md) — 唯一产品/系统目标。
3. [Agent Integration](design/agent-integration.md) — Agent surface、Assistant、CLI/MCP 与权限边界。
4. [Adaptive Layout](design/adaptive-layout.md) — #15 之后的 container-driven 布局规则。
5. [当前功能](content/docs/overview/features.mdx) — 已经可以对外描述的能力。
6. [后续待办](content/docs/progress/todo.mdx) — 尚未实现的工作。
7. [待测试确认](content/docs/progress/pending-test.mdx) — 已实现但仍需现实环境验证的工作。

[Support Matrix](../SUPPORT_MATRIX.md) 是兼容性与外部认证的唯一证据表，不作为另一份产品设计。

## 使用与参考

- [快速开始](overview/quick-start.md) / [Getting Started](overview/quick-start.en.md)
- [Agent Skill 使用](overview/skill-guide.md)
- [后端响应](content/docs/backend/api-response.mdx)
- [数据库结构](content/docs/backend/backend-database.mdx)
- [Studio host integration](../integrations/studio/README.md)
- [Workflow CLI](../skills/flovart/commands/workflow.md)

## ADR

[ADR index](adr/README.md) 只保留仍然有效、难逆转的短决策。已经被当前 IA 覆盖的 Agent workspace / Production Skill 产品分层不再留在 active ADR 列表。

## 历史

- [2026-09-23 文档 canonicalization 快照](archive/historical-design/2026-09-23-canonicalization.md)
- [Release candidate evidence](evidence/release-candidate/README.md)
- [Maintenance records](maintenance/README.md)

历史文档、旧报告和 Git 提交只能解释“当时为什么这么做”，**不能用于推翻 current-truth 文档**。
