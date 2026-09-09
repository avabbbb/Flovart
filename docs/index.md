# Flovart 文档索引

## 产品、架构与进度

- [当前实施：本地助手接入与创作软件插件](design/agent-and-creative-hosts.md)
- [Flovart Link 2.0 当前审计](design/flovart-link-2/CURRENT_STATE.md)
- [Flovart Link 2.0 目标状态](design/flovart-link-2/TARGET_STATE.md)
- [Flovart Link 2.0 状态机](design/flovart-link-2/STATE_MACHINE.md)
- [Flovart Link 2.0 Host 矩阵](design/flovart-link-2/HOST_MATRIX.md)
- [Studio Host packages 与认证清单](../integrations/studio/README.md)
- [领域词与工作区边界](maintenance/agent/CONTEXT.md)
- [发行候选证据索引](evidence/release-candidate/README.md)
- [维护资料索引](maintenance/README.md)
- [功能特性](content/docs/overview/features.mdx)
- [Features](content/docs/overview/features.en.mdx)
- [快速开始](overview/quick-start.md) / [Getting Started](overview/quick-start.en.md)
- [Skill 使用手册](overview/skill-guide.md)
- [后续待办](content/docs/progress/todo.mdx)
- [待测试确认](content/docs/progress/pending-test.mdx)
- [架构决策记录](adr/README.md)

## Agent：外部导演 + 唯一内置 Operator

- [15 份设计文档总览](design/agent/README.md)
- [架构总图](design/agent/01-architecture-overview.md)
- [权威与职责](design/agent/02-authority-and-responsibility.md)
- [CLI 与扩展](design/agent/03-director-harness-cli-and-extensions.md)
- [唯一内置执行 Agent 与 Production Crew](design/agent/04-production-crew-and-operator.md)
- [本地控制协议](design/agent/05-local-control-protocol.md)
- [会话绑定与交接](design/agent/06-session-projection-and-handoff.md)
- [Agent Workspace 体验](design/agent/07-agent-workspace-experience.md)
- [Workflow 工具与执行](design/agent/08-workflow-tool-and-execution-model.md)
- [安全与审批](design/agent/09-security-approval-and-trust.md)
- [迁移与验收](design/agent/10-migration-and-acceptance.md)
- [SPEC-001：`ctx.flovart` Service Contract](design/agent/11-flovart-service-contract.md)
- [SPEC-002：Workflow Mutation Contract](design/agent/12-workflow-mutation-contract.md)
- [SPEC-003：DSH Session / Flovart Project Binding](design/agent/13-session-project-binding.md)
- [SPEC-004：Flovart Durable Projection Events](design/agent/14-durable-flovart-projection-events.md)
- [SPEC-005：Flovart UI Availability 与 Mode Contract](design/agent/15-flovart-ui-availability-and-mode-contract.md)
- [ADR 0061：外部导演与唯一内置 Operator](adr/0061-use-external-director-and-internal-production-crew.md)
- [ADR 0062：DeepSeek Harness 内置原生 Workflow 画布（历史方案，已被 0063 取代）](adr/0062-use-native-workflow-canvas-in-deepseek-harness.md)
- [ADR 0063：DSH 只使用 Browser Workflow Authority](adr/0063-dsh-browser-workflow-authority.md)
- [ADR 0063：DSH 记录会话投影，Flovart Runtime 裁定生产事实](adr/0063-runtime-owns-production-facts.md)
- [ADR 0064：DSH Session 使用显式 Flovart Project Binding](adr/0064-bind-dsh-session-to-explicit-flovart-project.md)
- [ADR 0065：Workflow 变更使用版本前置条件与幂等 Mutation ID](adr/0065-idempotent-revisioned-workflow-mutations.md)
- [ADR 0066：DSH 集成模式下 Flovart 导航与连接状态解耦](adr/0066-decouple-flovart-navigation-from-runtime-availability.md)

## Runtime、Workflow 与 Provider

- [Workflow CLI](../skills/flovart/commands/workflow.md)
- [RunningHub 首期 Route Catalog](dev/runninghub-route-catalog.md)
- [Workflow 大型多节点项目交互与渲染设计](dev/workflow-large-project-interaction-design.md)
- [Production Runtime V1 实施规划](dev/production-runtime-v1-plan.md)
- [Production Runtime 数据契约](dev/production-runtime-data-contract.md)

## 后端

- [后端数据库结构](content/docs/backend/backend-database.mdx)
- [接口响应规则](content/docs/backend/api-response.mdx)
- [Enterprise 接口](content/docs/backend/enterprise-api.mdx)
