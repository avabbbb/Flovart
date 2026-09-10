# Flovart 文档

Flovart 当前提供 Workflow 与本地 Agent 创作入口；新方向是以原生效果插件为入口，复杂编排时展开工作区。AE/PR、PS 与 Resolve 原生效果仍在设计/开发阶段，当前面板包不代表原生效果已可用。

## 开始使用

- [快速开始](overview/quick-start.md) / [Getting Started](overview/quick-start.en.md)
- [Windows 安装](overview/installation.zh-CN.md)
- [Skill 使用](overview/skill-guide.md)
- [当前功能](content/docs/overview/features.mdx) / [Features](content/docs/overview/features.en.mdx)
- [支持矩阵](../SUPPORT_MATRIX.md)

## 设计与进度

- [原生效果与 Agent 协作主设计](design/flovart-native-effects.md)
- [后续待办](content/docs/progress/todo.mdx)
- [待测试确认](content/docs/progress/pending-test.mdx)
- [AI / 开发者索引](index.md)
- [历史验证证据](evidence/release-candidate/README.md)

Workflow、Table、Agent 保持各自职责。CLI/MCP 和宿主面板共用能力，生成与原生渲染分开；实施以短路径、少状态、少中间层为原则。
