# Flovart 文档索引

## Current truth：只读这 7 份

1. [AGENTS.md](../AGENTS.md) — AI/自动化开发约束与文档治理。
2. [产品与系统主设计](design/flovart-native-effects.md) — 唯一产品/系统目标；含 creative-host panel、native effect / OFX 产品与 UI 边界。
3. [Agent Integration](design/agent-integration.md) — Agent surface、Assistant、CLI/MCP 与权限边界。
4. [Adaptive Layout](design/adaptive-layout.md) — container-driven 布局规则。
5. [当前功能](content/docs/overview/features.mdx) — 已经可以对外描述的能力。
6. [后续待办](content/docs/progress/todo.mdx) — 尚未实现的工作。
7. [待测试确认](content/docs/progress/pending-test.mdx) — 已实现但仍需现实环境验证的工作。

[Support Matrix](../SUPPORT_MATRIX.md) 是兼容性与外部认证的唯一证据表，不作为另一份产品设计。

## Proposal / reference

- [Product Story & Agent Onboarding](design/product-story-agent-onboarding.md) — outcome-first launch、Skill-first Agent entry、reusable Workflow、Plan → Approve → Run。它是参考提案；接受的内容应蒸馏进上面的 current truth，而不是永久并列。

## 使用与实现参考

- [快速开始](overview/quick-start.md) / [Getting Started](overview/quick-start.en.md)
- [Agent Skill 使用](overview/skill-guide.md)
- [Studio host integration](../integrations/studio/README.md)
- [AE real-host checklist](../integrations/studio/AFTER_EFFECTS_REAL_HOST_CHECKLIST.md)
- [Resolve 21.1 Product & UI Spec](../integrations/studio/resolve/PRODUCT_UI_SPEC.md) — Resolve-first panel hierarchy, MCP/Skill split, safety and Hero contract
- [Resolve real-host checklist](../integrations/studio/RESOLVE_REAL_HOST_CHECKLIST.md)
- [后端响应](content/docs/backend/api-response.mdx)
- [数据库结构](content/docs/backend/backend-database.mdx)
- [Workflow CLI](../skills/flovart/commands/workflow.md)

## ADR

[ADR index](adr/README.md) 只保留仍然有效、难逆转的短决策。已经被当前 IA 覆盖的 Agent workspace / Production Skill 产品分层不再留在 active ADR 列表。

## 历史与证据

- [2026-09-23 文档 canonicalization 快照](archive/historical-design/2026-09-23-canonicalization.md)
- [README / launch audit 蒸馏快照](archive/historical-design/2026-09-23-readme-launch-audits.md)
- [Release candidate evidence](evidence/release-candidate/README.md)
- [README demo recording](maintenance/readme/DEMO_RECORDING.md)

历史文档、旧报告和 Git 提交只能解释“当时为什么这么做”，**不能用于推翻 current-truth 文档**。
