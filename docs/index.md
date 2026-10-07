# Iris 文档索引

## 设计（current truth，共 9 份）

| 文档 | 内容 |
| --- | --- |
| [00 总体设计](design/00-overview.md) | 产品一句话、模块地图、原则、关键决策、状态归属、路线图、对外口径、术语 |
| [01 交互设计](design/01-interaction.md) | 简单直接、不硬编码、不死锁三条总规则；通用状态模型；核心流程；布局；验收清单 |
| [10 Canvas / Workflow](design/10-canvas-workflow.md) | 可见生产图、mutation、素材语义 |
| [11 Table](design/11-table.md) | 结构化批量处理与显式提交 |
| [12 Agent](design/12-agent.md) | Skill + CLI、MCP 投影、连接中心、Assistant、安全边界 |
| [13 Generation & Runtime](design/13-generation-runtime.md) | 一条生成路径、Provider 路由、任务、素材版本 |
| [14 Creative Hosts](design/14-creative-hosts.md) | Resolve 首发、叠加层、上轨道、原生效果 |
| [15 Web, Community & Extension](design/15-web-community-extension.md) | 网站后端、社区、浏览器导入、发行 |
| [20 质量与治理](design/20-quality-and-governance.md) | 证据分级、评测、文档规则 |

支持等级只看 [SUPPORT_MATRIX](../SUPPORT_MATRIX.md)；AI / 自动化开发约束见 [AGENTS.md](../AGENTS.md)。

## 进度

- [当前功能](content/docs/overview/features.mdx) / [Features](content/docs/overview/features.en.mdx)
- [后续待办](content/docs/progress/todo.mdx)
- [待测试确认](content/docs/progress/pending-test.mdx)

## 使用指南

- [快速开始](overview/quick-start.md) / [Getting Started](overview/quick-start.en.md)
- [Windows 安装](overview/installation.zh-CN.md)
- [Agent Skill 使用](overview/skill-guide.md)

## 实现附录（在代码目录内）

- [Resolve 21.1 Product & UI Spec](../integrations/studio/resolve/PRODUCT_UI_SPEC.md)
- [Studio host packages](../integrations/studio/README.md) 与各宿主 `*_REAL_HOST_CHECKLIST.md`
- [Workflow CLI](../skills/flovart/commands/workflow.md)
- [后端响应](content/docs/backend/api-response.mdx) / [数据库结构](content/docs/backend/backend-database.mdx)

## 历史

- [2026-10-07 重构归档](archive/2026-10-07/)：旧主设计、ADR、开发契约、品牌迁移、维护资料、RC 证据
- [更早的归档](archive/)

历史文档、旧报告与 Git 历史只解释“当时为什么”，不能推翻上面的设计。
