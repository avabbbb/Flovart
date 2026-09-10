# Flovart 文档索引

## 当前设计与实施

1. [主设计：原生效果与 Agent 协作](design/flovart-native-effects.md) — 产品、交互、系统、具体实现、Benchmark、宣传和里程碑；新方向唯一主稿。
2. [领域词](maintenance/agent/CONTEXT.md) — 精简术语，不承载协议或施工步骤。
3. [待办](content/docs/progress/todo.mdx) / [待测试确认](content/docs/progress/pending-test.mdx) — 未完成与实际已变更分开。
4. [支持矩阵](../SUPPORT_MATRIX.md) — 当前证据边界，不把新目标标成支持。
5. [架构决策](adr/README.md) — 只保留仍有效的短决策。
6. [现有 CLI/MCP 接入边界](design/ecosystem/TARGET_ARCHITECTURE.md) / [Parity 记录](design/ecosystem/CROSS_PROJECTION_EVAL.md) — 当前代码的专项说明，不是并列产品目标；不替代新效果的 Benchmark。

## 使用与插件

- [文档首页](README.md)
- [快速开始](overview/quick-start.md) / [Getting Started](overview/quick-start.en.md)
- [Windows 安装](overview/installation.zh-CN.md)
- [Skill 使用](overview/skill-guide.md)
- [当前功能](content/docs/overview/features.mdx) / [Features](content/docs/overview/features.en.mdx)
- [现有 Studio 面板包](../integrations/studio/README.md) — Experimental，尚非原生效果。
- [Workflow CLI](../skills/flovart/commands/workflow.md) — 当前可执行命令；主设计里的效果接口仍待实现。

## 现有专项实现

- [RunningHub Route Catalog](dev/runninghub-route-catalog.md)
- [Workflow 大项目交互与渲染](dev/workflow-large-project-interaction-design.md)
- [Provider 扩展契约](dev/provider-extension-contract.md)
- [现有节点插件契约](dev/node-plugin-sdk.md) — 针对已存在节点，不要求新效果先建通用插件平台。
- [提示词资产](dev/prompt-asset-contract.md)
- [后端响应](content/docs/backend/api-response.mdx)
- [数据库结构](content/docs/backend/backend-database.mdx)
- [Enterprise 接口](content/docs/backend/enterprise-api.mdx)

## 历史验证证据

- [发行候选证据](evidence/release-candidate/README.md)
- [维护资料](maintenance/README.md)

证据只对原提交、机器和测试范围有效。旧 Agent/Link/Runtime 目标设计已合并删除，历史从 Git 查看；不得恢复为并列主设计，也不得把删文档误解为已删代码。
