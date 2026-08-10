# Flovart 架构决策

本目录只保留仍约束当前产品与实现方向的架构决策。ADR ID 是稳定身份，不要求连续；空号表示对应决定已被合并、降级为实施文档或删除，历史内容由 Git 保存，不在当前文档中继续制造噪音。

只有同时满足“难以逆转、跨越多个模块、存在真实取舍”的决定才新增 ADR。组件选择、发布步骤、测试清单、Provider 单线路参数和阶段性施工方案应写入 `docs/dev/` 或进度文档。

## 当前有效 ADR

- [0002：制作执行保持本地优先](0002-local-first-production-execution.md)
- [0010：Artifact 使用稳定 ID 与内容寻址](0010-use-content-addressed-local-artifacts.md)
- [0023：统一制作执行、授权与状态契约](0023-centralize-production-execution-contract.md)
- [0025：统一 Production Skill 契约与包边界](0025-standardize-production-skill-packages.md)
- [0027：使用 Schema 驱动的统一 Route Mapping](0027-use-schema-driven-route-mapping.md)
- [0037：不同发行入口共享一个核心](0037-separate-distribution-channels-over-one-core.md)
- [0039：分离 Workflow、Table 与 Agent 工作区](0039-separate-workflow-table-and-agent-workspaces.md)
- [0042：区分内置、Managed 与 Connected Agent](0042-separate-managed-and-connected-agent-support.md)
- [0049：发布真实作品与可选 Remix Bundle](0049-build-a-minimum-real-creator-community.md)
- [0052：使用一个负责的 Flovart Agent 与临时专家](0052-use-one-accountable-flovart-agent-with-specialists.md)
- [0057：在可替换画布端口后保留 Workflow 引擎](0057-preserve-workflow-engine-behind-a-replaceable-canvas-port.md)
- [0058：以 AI 原生 Workflow Draft 驱动画布](0058-use-ai-native-workflow-draft.md)
- [0059：以已批准样图锁定跨镜头视觉风格](0059-lock-visual-style-to-approved-reference.md)
