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
- [0049：发布真实作品与可选 Remix Bundle](0049-build-a-minimum-real-creator-community.md)
- [0057：在可替换画布端口后保留 Workflow 引擎](0057-preserve-workflow-engine-behind-a-replaceable-canvas-port.md)
- [0058：以 AI 原生 Workflow Draft 驱动画布](0058-use-ai-native-workflow-draft.md)
- [0059：以已批准样图锁定跨镜头视觉风格](0059-lock-visual-style-to-approved-reference.md)
- [0060：浏览器扩展使用桌面权威的受限导入桥](0060-use-a-desktop-authoritative-browser-import-bridge.md)
- [0061：使用外部导演 Harness 与唯一内置 Operator](0061-use-external-director-and-internal-production-crew.md)
- [0062：DeepSeek Harness 内置原生 Workflow 画布](0062-use-native-workflow-canvas-in-deepseek-harness.md)
- [0063：DSH 只使用 Browser Workflow Authority](0063-dsh-browser-workflow-authority.md)
- [0063：DSH 记录会话投影，Flovart Runtime 裁定生产事实](0063-runtime-owns-production-facts.md)
- [0064：DSH Session 使用显式 Flovart Project Binding](0064-bind-dsh-session-to-explicit-flovart-project.md)
- [0065：Workflow 变更使用版本前置条件与幂等 Mutation ID](0065-idempotent-revisioned-workflow-mutations.md)
- [0066：DSH 集成模式下 Flovart 导航与连接状态解耦](0066-decouple-flovart-navigation-from-runtime-availability.md)
- [0067：分离 Agent Identity、Distribution Target 与 Runtime Binding](0067-separate-host-projection-dimensions.md)
- [0068：首次安全生成使用渐进配置与显式费用授权](0068-first-safe-generation-boundaries.md)
