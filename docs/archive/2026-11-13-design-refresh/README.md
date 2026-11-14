# 2026-11-13 设计语言重构归档

> 历史快照，只读。只解释“当时为什么”，不能推翻 [docs/index.md](../../index.md) 列出的 current truth。

`docs/design/` 按 AGENTS.md §9 限制份数。本次把三份并列设计文档与 docs 根目录、plans、interview 下的一次性文档移出 active tree，仍有效的结论已蒸馏进对应文档：

| 原文 | 归档原因 | 现行结论所在 |
| --- | --- | --- |
| [30-competitive-replication.zh-CN.md](30-competitive-replication.zh-CN.md) | Working plan；14 项机制均已实现，方案取舍已完成，继续并列会与模块文档重复 | [10 Canvas / Workflow](../../design/10-canvas-workflow.md) §5.1 |
| [31-notion-compact-ui.zh-CN.md](31-notion-compact-ui.zh-CN.md) | Checklist；token 部分已在 2026-10-30 实施，属于视觉规范，不应是独立文档 | [DESIGN.md](../../design/DESIGN.md) §3、§8–§10；剩余清理项见 DESIGN.md §10 与 [01](../../design/01-interaction.md) §19.5 |
| [32-stream-usage.zh-CN.md](32-stream-usage.zh-CN.md) | 标为“设计稿 · 未实施”，但 L1–L5 已在代码中实现（`services/sse.ts`、`streamUsage.ts`、`streamUsageOptIn.ts`），文档已落后于代码 | [13 Generation & Runtime](../../design/13-generation-runtime.md) §6.1 |
| [AGENT_CANVAS_VS_LIBTV.md](AGENT_CANVAS_VS_LIBTV.md)（原 `docs/`） | 2026-11-04 一次性对标；LibTV 一侧未核实官方资料；其中的已落地改动（结构化工具失败、长任务进度、`flovart_todo`）已在代码与 [12 Agent](../../design/12-agent.md) | 12 Agent、01 §19.2 |
| [LIBTV_BENCHMARK_OPTIMIZATION.md](LIBTV_BENCHMARK_OPTIMIZATION.md)（原 `docs/`） | “面试版”对标报告，一次性；P0/P1 项（交付契约、节点来源、dry-run / 预算）已实现 | 12 Agent、13 Generation |
| [2026-11-07-plan-card-design.md](2026-11-07-plan-card-design.md)（原 `docs/plans/`） | 草案已实施（`components/GenerationPlanCard.tsx`） | [13](../../design/13-generation-runtime.md) §4 |
| [beta-readiness-0.3.0.md](beta-readiness-0.3.0.md)（原 `docs/plans/`） | 0.3.0 阶段性上线清单（AGENTS §9 不留 active tree） | `SUPPORT_MATRIX.md`、`pending-test.mdx` |
| [dsh-author-form.md](dsh-author-form.md)（原 `docs/plans/`） | 一次性表单填写文案 | — |
| [immersive-translate-benchmark.md](immersive-translate-benchmark.md)（原 `docs/plans/`） | 一次性竞品调研（插件上架方案） | [15 Web / Extension](../../design/15-web-community-extension.md) |
| [demo-scenarios.zh-CN.md](demo-scenarios.zh-CN.md)（原 `docs/interview/`） | 面试演示准备，一次性；数字随版本过时 | `SUPPORT_MATRIX.md` |

另：`docs/plans/2026-11-07-real-api-acceptance.md` 移为 [docs/quality/real-api-acceptance.md](../../quality/real-api-acceptance.md)（仍是有效的手工验收步骤，归入质量记录）。
