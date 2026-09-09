# Flovart 文档

这里是面向使用者的精简入口。仓库中的 ADR、Agent 设计稿、Runtime 契约和后端契约仍作为有效内部资料保留，但不在公开入口逐篇展开。

## 使用与产品

- [快速开始](overview/quick-start.md) / [Getting Started](overview/quick-start.en.md)
- [Windows 安装指引](overview/installation.zh-CN.md)
- [Skill 使用手册](overview/skill-guide.md)
- [功能特性](content/docs/overview/features.mdx) / [Features](content/docs/overview/features.en.mdx)

## 项目状态

- [后续待办](content/docs/progress/todo.mdx)
- [待测试确认](content/docs/progress/pending-test.mdx)
- [发行候选证据](evidence/release-candidate/README.md)
- [维护资料](maintenance/README.md)

以上共 8 个公开页面入口：中英文快速开始、Windows 安装指引、中英文功能页、Skill 手册、Todo 与 Pending Test。

## 内部设计与开发者索引

- [AI 与开发者完整索引](index.md)
- [Agent 十份设计文档](design/agent/README.md)
- [架构决策记录](adr/README.md)

现行产品由 Workflow、Table 与 Agent 三部分组成：Workflow 负责生成编排，Table 负责节点式媒体处理，Agent 的目标形态是“外部导演 Harness + 唯一内置 Workspace Operator”的制作现场控制面；Production Crew 只是执行组件集合。旧 Canvas / Art 只保留在 Git 历史，不再作为第四个功能入口或现行文档分类。
