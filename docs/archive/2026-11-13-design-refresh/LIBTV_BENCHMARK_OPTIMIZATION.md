# Flovart 对标 LibTV 的 Agent 化优化报告（面试版）

> **已归档（2026-11-13）**：一次性 / 已完成文档，不是 current truth。归档原因见本目录 [README](README.md)。

## 1. 背景与判断
LibTV 把「对话 Agent + 无限画布 + Skill 沉淀」做成闭环：Agent 产出直接落到画布、可定位、可复用，并强调「把一支视频做完」。Flovart 原本已有画布、命令分发与回执，但 Agent 结果「看不见、管不住、沉淀不下来、做不完」。本轮按 P0 → P1 → P2 推进，原则：纯逻辑独立成模块可单测；写操作走原有租约与草稿日志；花钱操作有硬上限且不绕过人工确认；优先复用已有数据结构。

## 2. 已落地
| 项 | 用户问题 | 方案 | 关键文件 |
| --- | --- | --- | --- |
| P0 统一交付契约 | Agent 说「做好了」，用户找不到结果 | 成功响应附 delivery（sessionId、projectId、canvasUrl、nodeIds），前端解析 focus 参数自动切工程并聚焦节点 | agent/delivery.js、components/workflow/deliveryLink.ts |
| P0 节点来源 | 分不清哪些是 Agent 改的 | metadata.origin（agent / user），由 dispatcher 按命令来源自动标记，不覆盖显式值 | services/workflowDispatcher.ts |
| P0 对话转 Skill | 好流程跑完就丢 | 回执 + 画布子图生成 Skill 草稿包，做结构、无环、无密钥、evals 一致性验收，通过才入库 | tools/flovart/skill-draft.js |
| P1 dry-run / 预算 / 暂停 | 怕 Agent 乱花钱 | dryRun 返回计划卡；会话预算（次数 + 有效期）为硬上限；可暂停 / 恢复；控制命令仅可信本地 CLI | agent/session-budget.js |
| P1 批量自动挑选 | 一次出 4 张要人工挑 | 外部评分优先，否则启发式（产物、分辨率、画幅）；失败候选不可选；写 decision 回执并 set_batch_primary（可撤销） | agent/batch-pick.js |
| P1 制作圣经 | Agent 每次要自己从节点拼项目状态 | workflow.inspect 附 productionBible：锚点表、按镜号排序镜头表、总时长、一致性问题 | components/workflow/productionBible.ts |
| P2 拆镜拼接 + 失败重试 | 长片超出模型单段上限；审核不过就卡住 | 镜头表按单段上限（默认 15s）等长拆段；拼接前检查缺镜 / 重复镜号，就绪后把有序 sourceNodeIds 交给现有 video.merge@1；失败按错误码分类：审核不过则确定性改写提示词重试，瞬时错误原样重试，提交结果未知 / 版本冲突 / 输入问题不重试，默认最多 2 次，每次产出 note 回执文案 | components/workflow/shotAssembly.ts |
| P2 故事板 + 引用到 Agent | 节点画布里看不出镜头顺序 | 项目有镜头时画布右上角露出「故事板」入口；按镜号列出时长、场景、是否已有视频与拼接就绪状态；点击聚焦节点；单镜 / 全部镜头一键引用到 Agent（复用 pushAgentGroup） | components/workflow/WorkflowStoryboard.tsx |

## 3. 关键取舍
- 安全面：batch.pick 暂不进 MCP 公开面（需工具名与注册表 schema），先走可信本地通道。
- 预算是硬上限而非授权：即使额度充足，浏览器端人工确认仍生效。
- 重试保守：可能已扣费的「提交结果未知」一律不自动重试；改写不调 LLM，结果可审计。
- 复用优先：拼接不新增 operation（video.merge@1 已按 shot.index 排序）；故事板不新增数据模型，只是制作圣经的另一种视图。
- 可解释性：自动挑选与重试都写明依据，方便用户推翻。

## 4. 验证
- 各项均有单测：交付链接、Skill 草稿、预算、挑选、制作圣经、拆镜 / 就绪 / 重试策略。
- 全量 tsc --noEmit：0 错误。
- 全量 vitest：246 个测试文件全部通过，1532 用例通过、1 跳过。
- 全量验证中发现并修复：skill-draft.js 未进 CLI 包 files；注册表去掉 config 节点类型后内嵌 registryHash 未更新。

## 5. 已知风险与下一步
- 拆镜 / 重试目前是规划层，尚未接成自动执行循环（生成 → 失败分类 → 改写重试 → 拼接）；下一步在 Agent 会话层串起来，并受会话预算约束。
- 单段上限默认 15s，应按模型能力表覆盖。
- 故事板暂无缩略图，样式为内联，尚未经浏览器实测。
- 预算 consume 在 dispatch 成功后，并发下可能超配；交付链接只聚焦首个节点。

## 6. 面试可讲的点
1. 从「Agent 能做」到「用户能看见、能控制、能复用、能做完」的产品闭环。
2. 安全与成本：硬上限、人工确认不可绕过、可能已扣费的失败不自动重试、控制命令不对外暴露。
3. 工程方法：纯函数 + 单测先行，复用已有数据结构（batch、shot、anchor、video.merge）而非另起一套。
