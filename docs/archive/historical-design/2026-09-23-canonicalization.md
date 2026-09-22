# Historical design snapshot — 2026-09-23

> **Historical only. Do not use this file as current product architecture.**
>
> 本快照把此前散落在 active docs 中的多代设计蒸馏到一个地方。原始全文仍可从 Git history 查看；删除 active copy 不等于删除历史或自动删除对应代码。

## 为什么做 canonicalization

在 #13 恢复 Canvas | Table | Agent、#15 完成 container-driven layout 之后，仓库仍同时保留多代互相冲突的叙事。Coding Agent 很容易把旧设计当当前规范，从而把 UI/架构改回已经否决的方向。

当前结论统一以：
- `components/studio/StudioTopMenu.tsx` 的 Canvas | Table | Agent；
- `components/agent/AgentWorkspace.tsx` 的 Agent connection hub；
- `App.tsx` 的 Assistant / Context / History contextual drawer；
- current-truth docs
为准。

## 历史代际

### A. Agent full-page collaboration workspace

旧 ADR 0039、部分 features/todo/audit 曾定义：
- Agent = 对话 + Tasks + Context + Artifacts；
- Agent 有自己的完整 workspace 状态；
- Agent panel 是顶级协作工作区。

后来产品收敛为：Agent 顶级页只做 connection/control；内置 Assistant 回到 Canvas/Table 旁边。

### B. Agent 被完全降级为 global drawer

HIGGSFIELD parity 报告和一段中间实现曾主张：
- kill top-nav Agent mode；
- Agent 只作为 Canvas/Table 的 global drawer。

#13 后该方案被否决：顶栏恢复 Canvas | Table | Agent，但 Agent 页不再承载聊天。

### C. Director / Production Crew / Workspace Operator

历史 Harness/Runtime 方案曾引入 Director、Production Crew、Workspace Operator、Crew Intent / Receipt、Dock / Native Draft 等层。

这些概念曾用于探索 DSH、长任务和控制面，但不再是当前用户必须理解或所有任务必须经过的产品层。对应代码若仍有真实调用点，按实现切片逐步清理。

### D. Production Skill 作为一级产品概念

旧 ADR 0025、Skill guide、主设计曾把 Operation Skill 与 Production Skill 都定义成正式产品层，并以 VOX 等 recipe 作为可复用制作包。

当前只保留 **Agent Integration Skill** 为正式接入概念。VOX / recipe / production-skill 相关实现可以作为实验内容或兼容资产存在，但不是一级 IA、Marketplace 承诺或新能力的强制编译格式。

### E. 多套 ecosystem CURRENT / TARGET architecture

旧 `docs/design/ecosystem/*` 同时维护 CURRENT_ARCHITECTURE、TARGET_ARCHITECTURE、OPERATION_SURFACE、HOST_MATRIX、CREATIVE_HOST_MATRIX、PRODUCTION_TASK、CROSS_PROJECTION_EVAL。

其中仍成立的内容已蒸馏到 current main design、Agent Integration、Support Matrix、pending-test / evidence；它们不再作为并列产品目标。

### F. 多份 responsive CURRENT / TARGET / AUDIT

旧文档记录过 `rightPanelInset` / viewport width state、220px / 256px 固定列、AgentWorkspace 百分比分栏、Dock/Bridge 结构，以及多轮修复前后的 debt/audit。

#15 后 current rule 是 container-driven composition。旧数字仍可用于理解历史 bug，但不能指导当前布局。

### G. Enterprise organization / credits / approval

历史 Hub 文档曾出现 organizations、departments、roles、credits、API-key pool、quota、approval 等企业模型。当前 backend database 文档已经按真实 Hub model 收敛；这些 enterprise 概念不属于当前产品设计。

### H. 一次性方向问题与成熟度报告

以下文件曾用于某一轮评审/决策：
- `HIGGSFIELD_PARITY_PRODUCTIZATION_REPORT.md`
- `PRODUCT_MATURITY_REPORT.md`
- `docs/design/sol-next-step-questions.md`

它们的价值是历史证据，不是持续规范。原始内容由 Git history 保存。

## 归档后 current model

~~~text
Canvas  = spatial Workflow creation
Table   = structured media processing
Agent   = local/external coding-agent connection hub

Canvas / Table right drawer
├─ Assistant
├─ Context
└─ History
~~~

外部 Agent 与内置 Assistant 调用同一受控业务能力；CLI + Agent Integration Skill 是默认外部路径，stdio MCP 是可选投影。

## 被 active tree 移除/合并的旧文档

- root: Higgsfield parity / product maturity reports
- `docs/design/adaptive-ui/*`
- `docs/design/responsive-ui/*`
- `docs/design/responsive/*`
- `docs/design/ecosystem/*`
- `docs/design/sol-next-step-questions.md`
- ADR 0025 / 0039

需要查看原文时使用 Git history，不要把它们复制回 active design tree。
