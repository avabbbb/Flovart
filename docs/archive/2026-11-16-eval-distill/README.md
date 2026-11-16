# 2026-11-16 评测文档蒸馏归档

> 历史快照，只读。只解释“当时为什么”，不能推翻 [docs/index.md](../../index.md) 列出的 current truth。

2026-11-16 建立评测总纲 [eval/eval.md](../../../eval/eval.md)（五层评测对象、执行成功率、Rubric 与 LLM-as-a-Judge、Auto Rubrics、四步归因、三阶段门禁）。此前两份 Agent / 工具链迭代报告属于一次性改动记录，改动已在代码与模块文档里，移出 active tree：

| 原文 | 归档原因 | 现行结论所在 |
| --- | --- | --- |
| [2026-11-11-agent-tool-eval.md](2026-11-11-agent-tool-eval.md) | 一次性迭代记录；外部方案核对结论与落地改动（文本节点 = 备注、裁剪 v2、视频工具、`workflow.apply --dryRun`、包围盒避让）均已实现 | [10 Canvas / Workflow](../../design/10-canvas-workflow.md)、[12 Agent](../../design/12-agent.md)；评测方法见 eval.md |
| [2026-11-12-agent-tool-eval-2.md](2026-11-12-agent-tool-eval-2.md) | 第一份的增量记录，同上 | 同上 |

两份的「未完成 / 下一轮」已去重后并入 [todo.mdx](../../content/docs/progress/todo.mdx)「现有工作区维护」；当时的评测做法（真实 API 验收、trace → 根因 → 修复 → 测试）由 eval.md §3、§7 与 [real-api-acceptance.md](../../quality/real-api-acceptance.md) 承接。
