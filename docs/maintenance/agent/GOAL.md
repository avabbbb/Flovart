# Flovart Autonomous Goal — Canvas Platform Convergence

## Mission

从已完成的 G0 架构审计继续，自主完成 G1–G7。保留 Flovart 的 Production Runtime、Artifact、Provider、CLI 与 Production Skill 能力，同时收敛 Canvas Contract、Agent Ops、引用交互与插件扩展面。

本文件是本 Goal 的长期任务入口；阶段状态与恢复信息写入根目录 `HANDOFF.md`。仓库既有 `.codex/GOAL.md` 是并行中的 Operation Registry 工作，不覆盖、不回滚，并在接口重叠处保持兼容。

## Autonomy

- 在 Goal 完成前不等待阶段批准；每个 Gate 通过后自动进入下一阶段。
- 允许读取、联网核验、修改本仓库、运行测试/typecheck/build/lint、启动本地 Runtime/Agent/WebUI、执行 localhost 浏览器 smoke、维护文档并修复失败。
- 只有真实凭据/付费或不可逆外部操作/生产 destructive write/无法从现有事实推断的重大产品决策/无替代验证的系统故障属于 hard blocker。记录后继续其他可完成项。
- 若计划与源码或验证冲突，先在 `HANDOFF.md` 记录 rationale，再采用更满足 invariants 的设计继续。

## Global Invariants

1. Canvas 写入入口可以很多，Document Mutation Core 只能有一个。
2. Generation 入口可以很多，`CanonicalGenerationInput` 只能有一个。
3. Provider Adapter 不理解 Canvas。
4. PromptBar 不理解 Provider wire format。
5. Agent 不理解 React state。
6. CLI 是 Adapter，不是第二 Workflow Runtime。
7. Browser-bound Workflow 不允许隐式 Native fallback。
8. Plugin 不允许绕过 Workflow / Resource / Provider contracts。
9. Skill 是 SOP / orchestration，不重新实现 Runtime。
10. 有 reference 但 Provider 无法消费时 explicit fail，禁止降级为无引用生成。
11. Document State、View State、Execution State 分离。
12. 旧接口可作为 compatibility adapter 存活，但不得继续持有独立业务实现。
13. Agent Identity、IDE Host、Distribution Target、Runtime Surface 与 Director Runtime Binding 必须是独立维度；WorkBuddy 作为未来 mainstream projection 候选，不得未经实现就进入 `director.bind`。

## Phase Gates

### G1 — Workflow Mutation Convergence

- 复用 `applyWorkflowOps`、Draft ChangeSet 与 Browser Draft Authority。
- `WorkflowMutationEnvelope` 包含 `projectId + expectedRevision + mutationId + source + ops`，远程 Browser 写入保持 `clientId` 绑定。
- Document Ops 进入 revision 与 undo/redo；View Ops 不改变 revision；run/stop 只经 `WorkflowExecutor`。
- 增加 `workflow.apply`；granular `workflow.*` 只做翻译适配。
- 验证原子 batch、幂等重放/payload 冲突、revision conflict、视图隔离、执行隔离、无 Native fallback、undo/redo、multi-tab 隔离、UI/CLI parity。

### G2 — PromptBar Reference Convergence

- 保留现有 PromptBar 视觉与交互，只收敛为 `PromptIntent`。
- Graph/Mention/Asset/Runtime Artifact 统一为 `GenerationReference[]`，再进入既有 resolver 与 canonical input。
- PromptBar 不导入 Provider、密钥或 wire 字段；完成 I2I/I2V 与 reference role 矩阵到 serializer 的验证。

### G3 — Agent Canvas Contract

- 稳定 `workflow.inspect`、`workflow.selection.get`、`workflow.apply`、`workflow.node.run`。
- 内置 Agent 模型工具只暴露 `status` 加上述 Workflow contract；`command.list` / `command.schema` 降级为 CLI bootstrap/discovery/debug，不形成第二套工具面。
- 通过 `host.list` 做 PATH-only Host discovery，`init --target` 负责 Distribution Target 安装；Agent Identity、IDE、Runtime Surface 与 Director Binding 不再共用一个 `host` enum。
- Codex 是当前 professional golden path；DeepSeek Harness 保留显式 native Plugin projection；CodeBuddy Code、Claude Code、OpenCode、Pi 通过 stable Skill + CLI contract 兼容；WorkBuddy 不阻塞本轮。
- Agent 先 inspect，写入只用 structured ops，不模拟 UI、不读 React/localforage、不解析 Provider。
- NativeWorkflowStore 仅供显式 native/headless workspace；Browser 模式无绑定时明确失败。
- 主 `flovart` Skill 覆盖 readiness/discovery/inspect/apply/run/recovery。

### G4 — Provider Extension Contract

- 统一 Official 与 sandboxed User Script Provider Adapter；旧 aiGateway 成为 compatibility seam。
- 用户脚本只接收 canonical input、非敏感配置、安全 fetch/resource accessor 与 opaque credential reference。
- 禁止 fs、child_process、process.env、raw secret、Canvas/React、任意本地网络。
- 不改源码完成自定义 image/video provider 的 submit/poll/cancel 与真实 reference payload 验证。

### G5 — Node Plugin SDK

- 建立 render/panel/outputs/inputs/toolbar/onDoubleClick/storage/events/applyOps contract。
- Plugin 不导入 Workflow internals、Provider internals、Runtime DB、raw secret 或直接 store mutation。
- 实现 Markdown、Storyboard Card、Style Bible 三个参考插件并验证完整生命周期与旧项目兼容。

### G6 — Skill / Prompt Ecosystem

- `flovart` 作为 capability Skill，Production Skills 只描述制作 SOP。
- 将 PromptPack 收敛为结构化 `PromptAsset`，支持 modality、model hints、reference roles、source、examples，禁止凭据。

### G7 — Final Integration & Acceptance

- 真实浏览器完成节点增删改连线、拖动、Undo/Redo、Selection/Viewport 与参数修改。
- 完成 Graph/@/Asset/Runtime Artifact 的 I2I/I2V 矩阵及至少一条真实 wire serializer 证据。
- 验证 Human UI / CLI / Agent 状态与 canonical input parity、`flovart start --open` 自动 ready、Provider 与 Plugin 生命周期。
- 全量 tests、typecheck、build、lint（若存在）、`git diff --check` 全绿。
- 搜索并审计所有潜在 bypass；修复后重跑全量验证。

## Recovery / Review

每阶段执行 baseline → implement → test → independent review → gate。第一次失败定位并修复；同一设计第二次失败时保留测试与审计结论，回到本阶段基线重新设计，禁止叠加 compatibility hack、恢复旧 fallback、跳过测试或 silent fallback。

完成条件以 G1–G6 实现且 G7 真实验收全部通过为准。

# Flovart Autonomous Goal — External Agent Golden Path

## Mission

在保留上一个 Goal 的 Workflow、Runtime、Provider、Plugin 与 Skill 边界的前提下，把真实外部 Coding Agent 的首次接入、自动启动、浏览器绑定、画布操作和断线恢复跑成产品级 Golden Path。Codex 是本轮 professional golden path；DeepSeek Harness 保持独立 Plugin Projection；其他 Coding Agent 通过稳定 CLI/Skill contract 兼容；WorkBuddy 仅作为未来 mainstream projection 候选，不进入当前 Director Runtime Binding。

## Autonomy

- 按 P0–P10 顺序自主审计、实现、测试、真实 smoke、独立复核和修复；Goal 完成前不等待阶段确认。
- 允许修改本仓库 CLI、UI、Skill、Plugin、文档和测试，启动/清理本机 localhost Runtime、Agent 与浏览器，并调用本机已安装 Coding Agent 做无付费、可回收的验证。
- 不使用真实付费 Provider 生成，不删除用户真实数据，不修改无关的全局 Agent 配置；缺少 Provider key 使用 local fake Provider 或 wire-level fixture。
- 每个阶段将状态、决策、变更、验证、风险和下一步写入根目录 `HANDOFF.md`。

## Invariants

1. Workflow Core 不理解具体 Host；Host-specific 行为只存在于 Host Projection/Distribution Adapter。
2. 正常 Agent 操作只使用 `status`、`workflow.inspect`、`workflow.selection.get`、`workflow.apply`、`workflow.node.run` 五个稳定命令。
3. Browser-bound project 的 Workflow authority 是当前 Browser Draft；无 binding 必须显式失败，不能静默回落 NativeWorkflowStore。
4. Agent Identity、Distribution Target、IDE Host、Runtime Surface、Director Runtime Binding 和 Browser Session 独立建模。
5. URL、Token、端口、clientId、wire protocol 只允许出现在脱敏 Developer Diagnostics；普通 UI 不展示、不要求用户输入。
6. Agent 语义操作必须经过 Workflow contract；浏览器自动化只用于产品 smoke，不用于实现 Canvas mutation。
7. `workflow.apply` 是唯一远程 Document mutation 入口，`WorkflowExecutor` 是唯一生成执行入口。
8. 同一 Workflow 同时可发现多个 Host，但同一时刻只有一个显式 Active Writer；切换必须撤销旧 Writer。
9. DSH 的 native/plugin 依赖隔离在 DSH projection，不污染 Browser Core，也不把不稳定 Harness API 带入 Core。
10. WorkBuddy 与 CodeBuddy Code 不混为同一个 Host：前者是未来普通用户入口，后者是 Coding Agent/CLI projection。

## Phases

- **P0**：审计 GOAL/HANDOFF、Host Registry、Agent Surface、启动链、浏览器绑定、DSH 与 pending-test，建立真实证据矩阵。
- **P1**：使用真实 Codex CLI 完成 Projection 安装、自动打开 Flovart、inspect/apply/run 以及可见画布 tracer bullet。
- **P2**：建立唯一 `FlovartBootstrapCoordinator`，处理 Runtime/Web/Browser/Host readiness、动态端口、一次性 bootstrap 和恢复。
- **P3**：完善 PATH-only Host discovery、产品化 Host Picker 和 Active Writer。
- **P4**：强化 Agent Session/Browser Session/Project binding、revision 与 mutation lock，拒绝 stale/tab/project 串写。
- **P5**：验证 refresh、关闭 tab、Runtime 退出、错误 Host、双 tab 和 Host switch 的恢复与错误可见性。
- **P6**：真实验证 DSH profile + installable bundle 的 install/boot/inspect/apply/uninstall，保持显式 native 边界。
- **P7**：对至少两个当前可用的非 Codex Coding Agent 执行稳定 CLI tracer bullet，不为每个 Host 增加 Core 业务逻辑。
- **P8**：简化首次运行 onboarding，只显示产品语言并自动 prepare Projection。
- **P9**：保留强 Developer Diagnostics，脱敏运行时与会话信息，不污染主 UX。
- **P10**：完成 Codex、已有用户、Host switch、DSH、手动用户五条验收路径，全量测试、浏览器 smoke、逆向架构复核和文档清理。

## Definition of Done

Codex 首次接入不需要用户填写 URL/Token/Port/JSON；Browser binding、inspect、structured apply、run 和恢复可被真实证据证明；DSH Plugin projection 与至少两个可用非 Codex CLI tracer bullet 通过；手动画布无回归；Core 不含 Host-specific Workflow logic；tests/typecheck/build/browser/external smoke 和 `git diff --check` 均有记录。无法由本机安全验证的外部登录或发布依赖必须在 `HANDOFF.md` 明确列为风险，不能伪称通过。
