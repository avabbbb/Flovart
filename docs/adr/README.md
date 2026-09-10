# Flovart 架构决策

当前产品与具体实现集中在[主设计](../design/flovart-native-effects.md)。本目录仅保留真实取舍；编号是稳定身份，不要求连续。删除的旧决策从 Git 历史恢复，不保留并列过时目标。

- [0069：原生效果、一条生成路径与独立本地渲染](0069-native-effects-with-one-generation-path.md)
- [0070：以 Canonical Contract 驱动 CLI、MCP 与 Native Projection](0070-contract-first-cli-mcp-native-projections.md)
- [0002：本地优先](0002-local-first-production-execution.md)
- [0010：稳定素材与内容寻址](0010-use-content-addressed-local-artifacts.md)
- [0023：共用任务实现](0023-centralize-production-execution-contract.md)
- [0025：复用 Skill 包](0025-standardize-production-skill-packages.md)
- [0027：Provider Route Mapping](0027-use-schema-driven-route-mapping.md)
- [0037：插件与工作区共用本地能力](0037-separate-distribution-channels-over-one-core.md)
- [0039：工作区状态分开](0039-separate-workflow-table-and-agent-workspaces.md)
- [0049：作品与 Remix 分享](0049-build-a-minimum-real-creator-community.md)
- [0059：现有 VOX 的已批准风格参考](0059-lock-visual-style-to-approved-reference.md)
- [0060：现有浏览器导入桥](0060-use-a-desktop-authoritative-browser-import-bridge.md)
- [0063：现有 DSH Browser 绑定](0063-dsh-browser-workflow-authority.md)
- [0065：Workflow 版本与幂等](0065-idempotent-revisioned-workflow-mutations.md)
- [0068：首次生成与费用范围](0068-first-safe-generation-boundaries.md)

0059/0060/0063 是各自现有功能范围的决定，不扩张为新效果的必经层。旧导演/Operator 架构、Native Draft、重复 0063、抽象画布端口与多份会话投影目标已经合并清理；必要的媒体选择、错误可见性和状态保护仍在 AGENTS.md 与主设计中。
