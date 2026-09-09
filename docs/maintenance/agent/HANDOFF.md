# Canvas Platform Convergence — Autonomous Handoff

## Current phase

G7 — Final Integration / Regression / Cleanup（已完成）

## Baseline

- 工作区在本 Goal 开始前已有大量未提交改动；全部视为用户工作，禁止回滚或覆盖。
- `.codex/GOAL.md` 是既有 Operation Registry 自治任务，本 Goal 与其并行，接口交叉时保持现有能力。
- G0 已完成只读审计；本轮接受的术语边界：Browser Draft / NativeWorkflowStore 是 State Authority，`applyWorkflowOps` 是 Browser document mutation kernel，`WorkflowExecutor` 是 generation authority，CLI/Bridge/Provider seams 是 adapters。
- 官方长时 Agent 实践已按 2026-08-27 当前资料复核：持续状态应落入仓库、长任务拆为可验证步骤、架构规则/测试/反馈/恢复应编码进 harness。

## Existing contracts to preserve

- `components/workflow/ops.ts`：现有语义 operation kernel。
- `components/workflow/draftAuthority.ts`：Draft ChangeSet、对象版本、Undo/Redo。
- `services/workflowExecutor.ts`：唯一节点 generation run/stop 入口。
- `components/workflow/inputResolver.ts`：现有 reference resolution 与 `CanonicalGenerationInput`。
- `services/workflowDispatcher.ts` + `services/workflowAgentBridge.ts`：Browser command adapter。
- `agent/session.js` + `agent/native-workspace.js`：Browser/显式 Native host adapters；Browser-bound 请求不会回落 Native，Native 仅由显式 Native/Headless workspace 使用。
- ADR 0065 与 SPEC-002：revision + mutationId + atomic `workflow.apply` + persisted receipt。

## G1 baseline findings

1. `WorkflowOp` 当前混合 document、view 与 execution semantics。
2. granular `workflow.*` command 各自构造并提交 mutation，尚无稳定 batch `workflow.apply` public contract。
3. Dispatcher 幂等缓存仅在内存，且同 key 不校验 payload；不能成为 document mutation authority。
4. Draft Authority 支持对象版本与 ChangeSet，但尚无 workflow-level `expectedRevision`、持久 mutation receipt 与 payload-reuse 拒绝。
5. UI 仍存在 `commitFrame/updateProject` 等 document write bypass，需要在不改变视觉交互的前提下收敛到底层 kernel。
6. Native workspace 注册后路由过宽；Browser-bound mutation 必须显式禁止 fallback。

## G1 implementation record

- 已复用现有 Draft Authority 与 `applyWorkflowOps`，没有新增第二套节点 mutation implementation。
- `WorkflowMutationEnvelope` 已固定 `projectId/expectedRevision/mutationId/source/ops`，Document、View、Execution 已分开；Document Ops 进入 ChangeSet/revision/Undo/Redo，View Ops 不改变 revision，执行仍只交给 `WorkflowExecutor`。
- `workflow.apply` 已加入 Browser Contract、Dispatcher、Agent、CLI registry；旧 granular `workflow.*` 仅翻译为同一批 Document Ops。
- mutation receipt 已按项目持久化并限制数量；同 mutationId 同载荷重放原 Receipt，不同载荷返回 `IDEMPOTENCY_KEY_REUSE`，过期 revision 返回 `REVISION_CONFLICT`。
- UI、CLI、DSH Browser projection 的 document writes 已进入同一 mutation kernel；交互拖动/预览仍保留临时内存投影，最终提交才形成 ChangeSet。
- Browser-bound Agent 没有连接时不会进入 Native Workspace；显式 Native 仍保留给 Native/Headless 场景。

## Verification status

- G0/source audit：完成。
- G1 targeted regression：通过（mutation envelope/receipt、dispatcher、editor、Agent session、CLI、store 等专项）。
- full Vitest：通过，单 worker `npx vitest run --maxWorkers=1` 为 128 个测试文件、908 个测试通过、1 个跳过（909 总数）。默认并行运行曾有 2 个 `workflowEditor` 超时；单文件与单 worker 均稳定通过，属于测试资源竞争而非断言失败。
- TypeScript：`npx tsc --noEmit` 通过。
- Production build：`npm run build` 通过；仅保留既有动态/静态导入与大 chunk 警告。
- `git diff --check`：通过（仅有既有换行提示）。
- browser smoke：真实可见浏览器已打开并加载 `Flovart` 主页面，Frontend/Agent 均 ready；但本机自动 bootstrap 后 `browserConnected` 仍为 false，CLI `workflow.project.list` 正确返回 `WORKSPACE_UNAVAILABLE`，未发生 Native fallback。该启动器/浏览器绑定问题记录为 G7 必须复查的环境风险，不能宣称浏览器 Gate 通过。

## Important invariants

完整列表见根目录 `GOAL.md`。当前重点：one mutation core、document/view/execution 分离、Browser-bound no Native fallback、legacy adapter-only、undo/redo 与多 Tab binding 不回归。

## G1 review notes

- 最后一轮审计确认 `commitFrame`、拖动预览和 `patchProject` 的直接写入只保留为临时/视图投影；最终 Document commit 统一由 `applyWorkflowMutation` 生成 ops 并调用 `applyWorkflowOps`。
- `recordWorkflowDraftSnapshotChange` 保留为兼容适配，但内部仍翻译到同一个 Draft mutation implementation。
- 没有读取或输出 Agent token，也没有把未绑定浏览器状态伪装成可用 Workspace。

## G2 implementation record

- 新增 `PromptIntent`，只携带 `targetNodeId/text/mentions/requestedAction`；Workflow Node PromptBar 在编辑、引用增删排序、生成/停止前发出 provider-neutral intent，未把 Provider、wire 参数或密钥放进该契约。
- `resolveWorkflowInputs` 现在把 PromptIntent、Graph、Asset、Runtime Artifact 和富文本 mention 统一为同一份 `GenerationReference[]`；提供新意图时忽略陈旧的 `mentionedNodeIds` 投影，保留资源身份、来源、顺序、角色与诊断。
- 生成链只从 `ResolvedNodeInputs` 构造 `CanonicalGenerationInput`，再一次性通过 `ProviderGenerationAdapter` validation/serialization；`first_frame/last_frame/reference/character` 角色矩阵已验证到最终 wire serializer。
- PromptBar 的产品模型、route、capability、参数归一化与费用展示计算已移到 `services/promptBarPolicy.ts`；UI 保留现有视觉与模型/参数交互，但不再直接导入 Provider Catalog、Gateway、route mapping 或 model-ref policy。

## G2 review notes

- 独立审计确认 PromptIntent 不包含 Provider/API key/wire 字段；旧 `mentionedNodeIds`、`imageReferenceOrder` 只在输入解析/兼容投影边界使用，未新增第二套引用数组。
- Graph + mention 去重、Asset、Runtime Artifact、I2I/I2V、Provider route capability、角色矩阵和实际媒体物化均有专项证据；Provider 无法消费引用时仍在提交前显式失败。
- 生成执行仍只由 `WorkflowExecutor` 调用，PromptBar policy 移出组件后没有改变已有 UI 视觉路径；full test 的并行超时用单 worker 重跑确认无功能回归。

## G3 implementation record

- Agent 的稳定 Workflow surface 已收敛为 `workflow.inspect`、`workflow.selection.get`、`workflow.apply` 与 `workflow.node.run`；`workflow.node.stop` 保留为执行控制兼容命令，仍只进入 `WorkflowExecutor`。
- 新增 `workflow.selection.get` 的 Registry、CLI alias、Dispatcher 与 Native explicit adapter；返回选择节点的脱敏投影，不写入 Draft、不改变 revision，Dispatcher 对读命令不复用旧缓存。
- 内置 Agent 与 Browser Agent 的 Workflow command envelope 现在强制 `workspaceMode: browser`；Agent 默认先 inspect/selection，再用结构化 `workflow.apply`，运行只走 `WorkflowExecutor`，禁止鼠标模拟、React/localforage graph 直读、Provider 重解析与隐式 Native fallback。
- `agent/session.js` 只在显式 `workspaceMode: native` 或没有 Browser 且已明确激活 Native workspace 时选择 Native；Agent source 和 Browser-bound command 永不降级到 Native。DSH Native Client 为每次请求显式标注 `workspaceMode: native`，没有改变 Browser authority。
- 旧 granular `workflow.*` command 继续作为 compatibility adapter，通过同一 Dispatcher/Draft mutation kernel；没有新增第二套 Browser document mutation implementation。

## G3 review and verification

- 审查确认 Document State、View State、Execution State 仍分开；`workflow.selection.get` 不增加 workflow revision，`workflow.node.run/stop` 不进入 mutation core。
- 专项与全量单 worker Vitest 通过：128 个测试文件、914 个测试通过、1 个跳过（915 总数）；`npx tsc --noEmit`、`npm run build`、`npm --prefix dsh-plugin run build` 与 `git diff --check` 通过。
- CLI 现场验证：未同步 Browser 时 `workflow.selection.get --json` 明确返回 `WORKSPACE_UNAVAILABLE`，没有进入 Native。真实可见浏览器从首页进入 `#/app`，Workflow 页面 HTTP 200、标题和主要文案正常、无 page/console error；本机 Agent 自动 bootstrap 后仍显示 `browserConnected=false`，绑定恢复列为 G7 环境风险，不能伪称已完成。

## G4 implementation record

- 现有 `providerGenerationAdapter` 继续作为 Official canonical capability/serialization adapter；新增 `ProviderGenerationExtensionRegistry` 与 `UserScriptProviderAdapter`，通过 `UserApiKey.extraConfig.providerScriptId` 选择用户线路，未绑定时仍走 Official adapter。
- User Script 的第一版明确采用受限 JSON mapping DSL，不执行任意 JavaScript；request、response、poll、cancel 由固定解释器执行，脚本上下文只有脱敏 canonical manifest 与已物化引用。
- endpoint 只允许 HTTPS 公网地址；path 只能留在同一 endpoint；受限 header、loopback、非 HTTPS 媒体地址和父级路径均明确拒绝。凭据以 opaque `read()` callback 交给宿主，只在最终 HTTP header 注入，不进入 mapping/body/节点/日志。
- `workflowGeneration` 选择 User Script extension 后跳过旧 Provider-specific route-mode 猜测，仍先完成 Canonical Input、extension capability validation 与 materialization；`executeUnifiedIgnition` 通过同一 canonical seam 执行 custom image immediate response 与 video task/poll/cancel。

## G4 review and verification

- 专项测试通过：User Script image wire mapping、Graph reference、video submit/poll/cancel、canonical ignition integration 与安全 endpoint 边界；Provider/Gateway 没有新增 Canvas 读取路径。
- 当前专项回归：4 个 G4 相关测试文件、119 个测试通过；全量单 worker Gate 为 129 个测试文件、918 个测试通过、1 个跳过；`npx tsc --noEmit`、`npm run build` 与 `git diff --check` 通过。
- 设计决策：不把 Infinite Canvas 的浏览器内任意第三方 JS trust model 带入 Flovart；Runtime/Desktop/CLI 的权限边界要求用户脚本保持声明式和最小权限。

## G5 implementation record

- 在既有 `WorkflowNodeDefinition`/`WorkflowResource` 注册表之上新增 `WorkflowNodePluginDefinition`：公共 SDK 以 `outputs`、可选 `inputs`、`render`、`panel`、`toolbar`、`onDoubleClick` 为节点扩展面，宿主将 `outputs` 归一化到既有 `output` Resource Contract；旧 `output` 仅保留为内部迁移兼容。
- 新增 `WorkflowNodePluginContext`：节点和图读取均为快照，更新只能转换为 `update_node`/结构化 Document Ops；插件私有存储按 project/plugin/node 命名空间进入 localforage，事件按 project/plugin 隔离，没有 Provider、Runtime DB、React store、凭据或 Canvas setter 暴露。
- `WorkflowNodePluginRegistry` 支持 install/update/enable/disable/uninstall，禁止重复 pluginId 与 node type；禁用/卸载只撤销渲染与输出注册，不删除项目中的节点，未知/已卸载节点仍可作为不可用占位被加载。
- `WorkflowNode` 和 `InfiniteWorkflow` 已挂载插件渲染、面板、工具栏、双击与 context.applyOps；内置图片/视频/音频及现有浮层路径保持不变。新增 Markdown、Storyboard Card、Style Bible 三个 reference plugin。

## G5 review and verification

- 独立边界审查确认插件 SDK 文件没有 Provider/Gateway/Runtime/React store/凭据依赖；插件渲染使用宿主快照，未知自定义类型不会索引内置规格，也不会在首页项目摘要显示 `undefined`。
- 专项测试：Node Plugin SDK、节点浮层、Workflow Editor、Workflow Ops 共 4 个文件、83 个测试通过；节点资源/输入解析专项共 3 个文件、19 个测试通过。
- 全量 Gate：单 worker `npx vitest run --maxWorkers=1` 为 130 个测试文件、922 个测试通过、1 个跳过（923 总数）；`npx tsc --noEmit`、`npm run build`、`npm --prefix dsh-plugin run build` 与 `git diff --check` 通过。Build 仅有既有大 chunk/动态导入提示。
- 仍需 G7 真实浏览器验收：参考插件目前通过 SDK/React 测试验证，自动 Bootstrap 后的 `browserConnected=false` 仍是既有 G7 风险，不能在本记录中宣称已完成。

## G6 implementation record

- 既有 `.agents/skills/flovart`/`skills/flovart` 保持为 capability/Operation Skill，明确负责 readiness、command discovery、inspect、structured mutation、execution 和 recovery；Production Skill 继续只提供制作 SOP、Gate 与 provider-neutral ProductionSpec，不直接执行 Runtime/Provider/Workflow。
- 新增 `services/promptAsset.ts`：统一 `id/title/text/tags/modality/modelHints/requiredReferenceRoles/optionalReferenceRoles/source/examples`，社区 PromptPack/Item 与内置快速提示词都经过同一归一化函数；支持按文本、标签、模型提示和 modality 搜索。
- PromptAsset 显式拒绝明显的 API Key/Bearer 凭据文本；Prompt、Skill 和 Workflow 仍不保存原始密钥或 Provider wire 配置。Workflow 快速提示词菜单、社区提示词详情已使用 PromptAsset，不改变生成或 Provider 路径。

## G6 review and verification

- 审查确认主 Skill 与 Production Skill 通过 `LocalSkillKind`/manifest/contentHash 分离；Skill registry、Hub 安装、内置包保护和 ProductionSkill attachment 继续沿用现有实现，未新增第二 Runtime。
- PromptAsset/Skill/Home/Workflow 相关专项为 5 个文件、32 个测试通过；全量 Gate 为 131 个测试文件、926 个测试通过、1 个跳过；`npx tsc --noEmit`、`npm run build`、`npm --prefix dsh-plugin run build` 与 `git diff --check` 通过。Build 仅有既有大 chunk/动态导入提示。

## G7 final integration record

- Fresh system Chrome 通过 `agentConnectionBootstrap` 打开 `#/app` 后自动建立 Browser binding；同一会话中 CLI `status --json` 返回 `ready: true`、Frontend/Agent ready、`clients: 1`、`hasWorkflow: true`，`workspace.status` 返回 `authority: browser-workspace`、`state: ready`，`nativeWorkspace: false`，无 page/console error。
- 真实浏览器 UI 回归通过：新增文本/配置节点、编辑文本、拖动节点、句柄连线、删除、Undo、Redo；节点与连线计数分别正确恢复/重做，未出现 page/console error。
- 同一浏览器会话的 CLI `workflow.apply` 成功写入 `plugin:markdown` 节点并实时渲染 Markdown reference plugin；CLI `workflow.inspect` 读到同一节点，`workflow.selection.get` 返回当前选中节点；stale `expectedRevision` 返回 `REVISION_CONFLICT`，不同载荷复用 mutationId 返回 `IDEMPOTENCY_KEY_REUSE`。
- G7 静态复核确认：Document mutation 仍由 `applyWorkflowMutation → applyWorkflowOps` 承担，View Ops 与 Execution 分开；旧 granular command 只作 compatibility adapter；PromptBar 没有 Provider wire/凭据职责；User Script/Node Plugin 没有 `eval`、`new Function`、Runtime 文件或原始凭据访问。

## G7 review and verification

- 全量 Vitest：131 个测试文件通过，926 passed、1 skipped（927 total），使用当前 Vitest 支持的 `--no-file-parallelism --maxWorkers=1`。
- TypeScript：`npx tsc --noEmit` 通过。
- Production build：`npm run build` 通过（4299 modules transformed）；仅保留既有动态/静态导入与大 chunk warning。
- DSH plugin build：`npm --prefix dsh-plugin run build` 通过，index/client loader contract verified。
- `git diff --check` 通过，仅输出 Git 换行转换提示；本 Goal 未回滚或覆盖既有用户改动，临时浏览器验收脚本已删除。
- 真实 Provider 付费生成未在本轮触发；G2/G4 的 canonical/reference/wire、custom image/video submit-poll-cancel 由专项测试和 fake provider fixture 覆盖，实际第三方凭据仍保留在用户确认范围。

## Surface Simplification implementation record

- 新增版本化 `host-registry.v1.json`，把 Agent Identity、IDE Host、Distribution Target、Runtime Surface 与 Director Runtime Binding 分开；`workbuddy` 只登记为未来 `skill-mediated` projection，未加入 Director Binding，`codebuddy-code` 使用 Coding Agent 身份，不与 WorkBuddy 混用。
- 新增 `host.list` PATH-only discovery 与 Agent Host picker；发现过程不扫描 auth/OAuth/API Key，picker 只保存 Host 偏好，不自动切换 Director 会话绑定。
- `init` 改为 `--target` 安装投影；`director.*` 接收 `agentIdentity` 并在 adapter 边界映射内部 Runtime binding。内置 Agent/Browser Agent 的公开面收敛为 `status`、`workflow.inspect`、`workflow.selection.get`、`workflow.apply`、`workflow.node.run`；`command.list/schema` 仅保留 CLI bootstrap/discovery/debug。
- Settings 的 Runtime 凭证继续保持 Runtime-only，不伪装成网页 BYOK；网页 AI 服务设置改为渐进展开，PromptBar 与相关入口使用 AI 服务/访问凭证产品词汇。
- 本轮审计发现并修复 `workflowDocumentOperationsFromFrames` 生成的 `reorder_nodes` 未被 `applyWorkflowOps` 执行的问题；该修复仍进入唯一 Document Mutation Core。

## Surface Simplification verification status

- Host registry、Agent tool surface、Agent Kernel、Workflow right panel 等定向测试已通过；当前新增/修改后的完整 Vitest、TypeScript、Production build、CLI smoke 与真实浏览器 Host picker/Workflow 路径仍需本轮继续执行。
- 不把 WorkBuddy probe、WorkBuddy Director Binding 或双 Tier-1 Host 作为本轮阻塞项；后续只在独立 mainstream Host Projection 目标中评估 WorkBuddy。

## Final status

此前 G0 只读审计与 G1-G7 Gate 已完成；本轮 Surface Simplification 在既有 Goal 上追加了 Host/Agent 契约收敛，待本轮新增实现的全量验证完成后再更新最终状态。此前的 Browser/CLI 证据不替代本轮对 Host discovery、picker 和精简工具面的验证。

## Next action

完成本轮自动验证后，再等待用户按 `docs/content/docs/progress/pending-test.mdx` 执行 Provider 凭据、默认 `start --open`、Codex golden path 和插件生命周期的产品级确认；不要把这些用户确认项误写成已完成能力。

# External Agent Golden Path — latest status

## Current phase

P10 — Final Autonomous Acceptance（代码与本地运行证据完成；外部登录/用户确认项保留为风险）

本节覆盖本文件早期 G7/Simplification 记录之后的最新结果。较早记录中的 `browserConnected=false` 基线风险已由下面的真实浏览器会话复测；没有外部 Codex 登录证据的部分仍不得写成通过。

## Phase evidence

- **P0**：已审计 `GOAL.md`、现有 HANDOFF、pending-test、ADR 0067、Host Registry、稳定 Agent Surface、init/director、Host Picker、Skill、DSH bundle 和 Browser bootstrap。WorkBuddy 维持未来 Mainstream Projection，CodeBuddy Code 单独作为 Coding Agent identity。
- **P1**：`init --target codex` 在临时项目真实生成 Codex Skill projection，canonical target 为 `codex-skill`，没有生成 MCP 配置；本地真实 Browser tracer 已完成 inspect、两个节点新增、移动、连线、节点修改、Undo/Redo、刷新与再次 inspect。真实 `codex exec` 已实际探测，但本机 `codex login status` 为 `Not logged in`，API 返回 401，未触发付费生成，因此“从新 Codex 对话发起”的最后一跳仍未验证。
- **P2**：新增唯一 `FlovartBootstrapCoordinator`，协调 Agent/Web/Browser readiness，不承担 Workflow mutation 或 Provider execution。`start --source --web --json` 在默认 Web 端口被占用时选择可用动态端口（实测 `6114`），通过页面标记拒绝误连其他 loopback 服务，并输出结构化状态；默认 `flovart start --open --json` 已真实复测通过，复用 `37522` WebUI、启动 `17373` Agent 并完成 Browser binding。另用隔离临时配置制造 Agent 启动失败，确认仍返回 `ok:false + frontend.ready + agent.offline`，不抛出堆栈。Windows URL 启动改用系统 URL handler，避免 `cmd /c start` 将 bootstrap 查询中的 `&agentToken` 拆成命令；bootstrap token 仍只走短期 URL 交换，不写入日志。
- **P3**：PATH-only `host.list` 实测发现 Codex、Claude Code、OpenCode、Pi、DeepSeek Harness；CodeBuddy Code 未安装；WorkBuddy 显示为未来入口且不可作为 Director Binding。真实 Host Picker 显示产品名称、可用/未安装/未来状态和 Active Writer CTA，不显示 executable、端口或 token；Picker 使用轻量 `includeVersion=false` 发现请求，版本信息继续留在 CLI/诊断。
- **P4**：Browser Workflow Session 按 `clientId/projectId/revision/mutationId` 约束写入；项目不匹配、stale revision、重复 mutationId 不同载荷、失去 active writer 都显式失败。Crew/Director Binding 另按 `agentIdentity → runtimeHostKind → externalSessionId → ProductionSession` 管理；不为没有稳定 session identity 的 Agent 伪造 `hostSessionId`，也不把 `director.bind` 强行接入普通 Workflow Dispatcher。多 Tab 不会静默抢写，重新绑定必须显式 activate。
- **P5**：真实浏览器证据覆盖 refresh 自动重新注册、关闭 active tab 后 `WORKSPACE_UNAVAILABLE`、第二 Tab 显式重新激活、运行时重启后重新连接、双 Tab writer 约束；运行失败显示缺少模型映射且 `paidProviderCalled=false`。证据文件见 `C:\tmp\flovart-external-agent-golden.json`、`C:\tmp\flovart-writer-recovery.json`、`C:\tmp\flovart-recovery-control-20260829-f.result.json`。
- **P6**：真实 RC8 DSH profile 已完成 install、dump-config、boot 和浏览器页面 smoke；隔离 Native Workspace 的真实 CLI 已完成 create/apply/inspect，run 返回明确 `RUNNER_UNAVAILABLE`，未回落 Browser 或伪造 Provider 结果。Workspace Operator 被精确终止后已真实自动重启并保持会话 URL，Native view 增加重启后的自动重注册；重启后 CLI 已完成 Director bind/handoff/status，旧 Binding 归档且新 Session 成为 Active。`profile:uninstall` 已验证只移除 Flovart profile 并保留 Workspace/其他 Profile；DeepSeek 真实对话和升级回滚因缺少登录态/发布条件未宣称通过。
- **P7**：Claude Code 与 OpenCode 已完成真实外部 CLI tracer：两者均由各自 Coding Agent 发起 `status → workflow.inspect → workflow.apply → workflow.inspect`，在同一 Browser-bound project 中成功新增临时文本节点并验证 `applied:true`、revision receipt 和最终节点；证据与清理 mutation 保存在 `C:\tmp\flovart-external-host-tracers-20260829.json`。Pi 正确拒绝不支持的专用 distribution target；CodeBuddy Code 当前未安装。
- **P7 补充**：另一次只验证 Claude Code 触发 bootstrap 的尝试在外部 Agent 自身达到 `$0.50` API 预算后中止，未返回完整 transcript；未调用 Provider/生成，也未修改仓库，因此不计入 Golden Path 通过证据。随后已用 canonical `start --open --json` 独立确认同一 Runtime/WebUI/Browser bootstrap 可用。
- **P8**：Host Picker 的显式选择现在会通过已认证的 `/hosts/prepare` 自动准备对应 Skill Projection；真实浏览器 smoke 从 bootstrap 页面进入 Agent Workspace，选择 Claude Code 收到 HTTP 200 并显示“Claude Code 的 Flovart Skill 已准备”，另一次选择 DeepSeek Harness 显示“由其 Plugin/Profile 管理”，WorkBuddy 仍为禁用的未来入口。地址栏 bootstrap 参数已清理，普通页面没有 URL、Token、端口或 executable；证据见 `C:\tmp\flovart-host-projection-20260829.json`、`C:\tmp\flovart-host-projection-20260829.png`、`C:\tmp\flovart-dsh-picker-smoke-20260829.json` 与 `C:\tmp\flovart-dsh-picker-smoke-20260829.png`。
- **P9**：首次运行 Picker 与 Agent 状态使用产品词汇；实现保留 Advanced Diagnostics 边界，运行时实际 URL、PID、client/project/revision 和日志只进入脱敏诊断，不进入普通页面或稳定工具返回。
- **P10 收口**：独立复核后，公共快速开始改为 `status → start --open（必要时）→ workflow.inspect`；Host Picker 使用 `includeVersion=false` 的轻量发现请求，版本探测保留在 `host.list`/诊断。定向 Host/Session/DSH 回归为 5 个文件、46/46；完整 Vitest 最新结果为 136 个文件通过、972 passed、1 skipped（973 total）。
- **P10 边界修复**：独立检索发现 Dock 未绑定态曾用时间戳伪造 DSH sessionId；现已删除自动绑定按钮，只保留复制显式 `director.bind` 命令，真实 Session 必须由外部 Harness/Plugin 提供。Dock、Host、Session、DSH 定向回归 40/40 通过。
- **P10 打包与 CLI 复测**：`npm pack --dry-run --json` 已确认 Agent/Host/Skill 模块进入 CLI 包；隔离临时项目实际启动 packaged Managed Agent，PATH discovery 返回 7 个 Host，并将 Codex Skill 写入调用方项目，不写入 bundle 目录。Toolkit launcher 保留调用方工作目录，并把 `FLOVART_PROJECT_DIR` 传给 Runtime/Managed Agent；启动失败会清理本轮拉起的子进程。脱敏记录见 `C:\tmp\flovart-packaged-agent-smoke-20260829.json`。
- **P10 新鲜 Browser tracer**：带 bootstrap 参数的新浏览器会话完成自动认证、创建 Workflow、激活 writer；真实 `flovart` CLI 完成 `workflow.inspect → workflow.apply`（新增两个节点、移动、改名、连线）→ 再次 `workflow.inspect`，页面出现两个更新后的节点且无 console error。该证据证明 canonical CLI/Browser 闭环，不冒充已登录 Codex 对话；脱敏记录为 `C:\tmp\flovart-canonical-cli-browser-golden-20260829.json`，截图为 `C:\tmp\flovart-codex-golden-20260829.png`。
- **P10 契约修复**：DSH CLI 参数对象/数组现在序列化为 JSON flag，不再发送 `[object Object]`；Rust Runtime 内嵌 Registry Hash 已与当前 canonical registry 对齐，`cargo test --all-targets` 全部通过。
- **P10 Launcher Writer hardening**：`buildBrowserBootstrapUrl` 只给 CLI 启动的新页面附加一次性 `activateBrowserWriter=1`；Browser bootstrap 认证成功后把信号存入 tab-scoped `sessionStorage`，消费一次并清除 URL 中的 token/flag。第一份 snapshot 发送成功后才调用 `/workflow/activate`，普通第二标签仍必须显式激活。`FlovartBootstrapCoordinator` 会记录打开前 Active Writer，并等待新页面真正成为 Writer，避免旧标签“ready 但 CLI 不可用”。真实双标签 smoke 已验证 client 切换、同项目、参数清除和 signal consumed；证据为 `C:\tmp\flovart-bootstrap-writer-20260829.json`，截图为 `C:\tmp\flovart-bootstrap-writer-20260829.png`。
- **P10 默认浏览器复核**：在精确重启本机 Flovart Agent、清除旧 SSE 客户端后，真实 `npm run flovart:cli -- start --open --json` 再次通过 Windows 默认 URL handler 打开 Edge，返回 `browser.status=connected`；随后顺序执行 `workflow.inspect --agent-identity codex` 与 `workflow.selection.get --agent-identity codex` 均命中同一 Browser-bound project（revision 10）。此前旧 Agent 进程的 stale in-memory client 会造成 `status` 旧快照乐观而 inspect 等待，已被明确识别并通过受控 Agent 重启恢复；没有用成功状态掩盖失败，也没有引入 Native fallback。最新恢复证据为 `C:\tmp\flovart-start-open-recovery-20260829.json`。
- **P10 安全执行 fixture**：在真实 Browser binding 上创建并随后删除隔离临时 Workflow，以本地 `image.crop@1` Operation 验证 `workflow.node.run --agent-identity codex` 经过 Browser `WorkflowExecutor` 成功生成新 Take/输出节点（revision 4 → 6、`providerCalled=false`、无付费请求）；原项目恢复为 revision 10、0 个节点，证据为 `C:\tmp\flovart-browser-node-run-local-fixture-20260829.json`。Provider 成功路径仍只由既有 fake/wire 测试覆盖，未写入真实凭据。
- **P10 CLI compatibility boundary**：修复 granular `workflow.node.tool` CLI 适配器的 typed argument normalization；`--x/--y/--width/--height`、时间/数值参数、逗号或 JSON 数组以及 dashed aliases 现在在进入既有 Dispatcher/Operation schema 前归一化。五个模型-facing tools 与 Workflow Core 均未扩展；`workflowCli` + `workflowDispatcher` 聚焦回归 26/26 通过。

## Architecture decisions

```text
Flovart Core
    ↓
Stable Agent Surface
    ↓
Host Projection / Distribution Adapter
    ↓
Codex / DSH / Generic CLI Hosts
```

- Core 不包含 Codex、DSH、CodeBuddy 或 WorkBuddy 分支；Workflow mutation 仍只有 `workflow.apply`，执行仍只有 `WorkflowExecutor`。
- `Agent Identity`、`Distribution Target`、`IDE Host`、`Runtime Surface`、`Director Binding` 和 Browser Session 不再由一个 `host` enum 承担。
- Browser-bound Workflow 没有 binding 时只返回 `WORKSPACE_UNAVAILABLE`；Native/Headless 只在显式模式使用。DSH 的 Native adapter 和 profile/bundle 依赖留在 `dsh-plugin/` 与 `agent/native-workspace.js` 边界。
- 正常 Agent surface 仍只有 `status`、`workflow.inspect`、`workflow.selection.get`、`workflow.apply`、`workflow.node.run`；`command.list/schema` 仅为 discovery/debug。

## Changed areas

- 启动与发现：`tools/flovart/bootstrap-coordinator.js`、`dev-commands.js`、`local-agent.js`、`local-status.js`、`web-discovery.js`、`host-registry.js`、`agent-kit.js`、`vite.config.ts`。
- 会话与 UI：`agent/session.js`、`services/agentConnectionBootstrap.ts`、`services/workflowWorkspaceAdapter.ts`、`services/workflowAgentBridge.ts`、`stores/useAgentConnectionStore.ts`、`components/agent/AgentHostPicker.tsx`、`components/workflow/WorkflowWorkspace.tsx`、`components/dock/ProductionControl.tsx`（不再伪造 Director Session）。
- DSH projection：`dsh-plugin/src/`、`dsh-plugin/scripts/profile.mjs`、`dsh-plugin/scripts/workspace-supervisor.mjs`、`dsh-plugin/assembly.json`、`agent/config.js`、`agent/crew/store.js`、`agent/native-workspace.js`。
- Host Projection prepare：`agent/host-projection.js`、`agent/index.js` 的认证 `/hosts/prepare`、`services/agentHostDiscovery.ts`、`components/agent/AgentHostPicker.tsx` 与 `tests/agentHostProjection.test.ts`。
- 启动/恢复：`tools/flovart/dev-commands.js` 的 Windows URL handler 与 WebUI 复用，`tools/flovart/bootstrap-coordinator.js` 的新 Writer 等待，`services/agentConnectionBootstrap.ts` 与 `tools/flovart/local-agent.js` 的一次性 bootstrap/URL 清理，`dsh-plugin/src/client/WorkflowView.tsx` 的 Native health re-register。
- 契约/文档/测试：Host Registry、5-tool surface、bootstrap、Web discovery、session/recovery、DSH native apply 和 browser smoke tests；临时 evidence 保存在 `C:\tmp`，不含凭据。

## Verification gates

- 定向新增回归：`flovartDevCommands` 13/13、`dshHarnessLauncher` + `dshNativeWorkflowView` 14/14、Host/Session/DSH 合并定向回归 5 个文件 46/46、`flovartAgentKit` 合并定向测试通过；另有 bootstrap/connection/adapter/local-agent 4 个文件 18/18；覆盖 Windows URL handler、profile uninstall、Workspace state isolation、Supervisor restart、Native re-register、轻量 Host discovery、新 Writer 等待和 Browser Writer/Binding 边界。
- 真实外部 CLI tracer：Claude Code 与 OpenCode 各自完成 `status → inspect → apply → inspect`；Provider/media generation 未调用，临时节点均经 `workflow.apply` 清理。
- `npx vitest run --no-file-parallelism --maxWorkers=1`：`136 files passed`，`972 passed | 1 skipped`（973 total）。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过；仅有既有动态导入和大 chunk warnings。
- `npm run ext:build`：通过，生成薄 Browser Import extension；本轮未改变扩展权限/协议边界。
- `npm --prefix dsh-plugin run build`：通过，loader contract verified。
- `git diff --check`：通过，仅有 Git 换行转换提示。
- 真实浏览器 Workflow、Host Picker Projection prepare、writer recovery、Runtime recovery 和 DSH RC8 profile smoke：通过，Host Picker smoke 与新鲜 CLI/Browser tracer 的页面/控制台错误为空；关闭页面时的 SSE abort 已从证据中排除为测试清理事件。

## Remaining risks / exact next steps

1. 登录 Codex CLI 后，从全新 Codex conversation 重跑 `打开 Flovart → inspect → apply → run local fixture`，补齐真正外部 Codex transcript；不得使用真实付费 Provider 生成。
2. 用户确认默认窗口体验、手动画布路径和 Provider 配置/费用边界；本机默认 `flovart start --open --json` 的命令级和 Browser binding 证据已通过。
3. DSH 仍需真实登录态页面重载确认、升级回滚和显式 Browser/Native Authority transfer；profile uninstall、Workspace 崩溃重启、state isolation 和多 Session Handoff 已有本机证据。

本 Goal 当前不标记为完全完成：Claude Code/OpenCode 外部 tracer 已通过，但 Codex 登录态、用户可见确认和 DSH 部分生命周期仍是外部依赖；不存在需要恢复旧 Native fallback 的实现理由。

# External Agent Golden Path — P0 Audit

## Current phase

P0 — Baseline Audit & Pending-Test Reconciliation（已完成，进入 P1）

> 本节矩阵是 P0 开始时的历史基线；后续 P1–P10 的当前结论以本文件上方的 “External Agent Golden Path — latest status” 为准。表中 `Not yet` 不代表当前仍未完成，除非上方 Remaining risks 明确保留该项。

## Scope correction

- 本 Goal 的 Tier-1 重点是 Codex professional golden path；WorkBuddy 只保留为未来 mainstream projection 候选。
- `WorkBuddy`（普通用户 AI 办公工作台）与 `CodeBuddy Code`（Coding Agent/CLI）不作为同一个 Host 处理；当前 `director.bind` 不接收二者。
- 本轮以真实外部 Agent → Flovart CLI → Browser Workflow 的闭环为验收中心，不把旧的内部浏览器 smoke 或 `host.list` 结果误记为外部 Agent 通过。

## P0 evidence matrix

| Capability | Unit/Test evidence | Browser smoke | External Codex | DSH | Product confirmed |
| --- | --- | --- | --- | --- | --- |
| Host dimensions / PATH discovery | Host registry and discovery tests pass; planned WorkBuddy is not probed | Agent Host Picker mounted; offline state visible | Not yet | Not applicable | Pending real user path |
| Five-command Agent surface | Agent tool tests and CLI registry pass | Agent Workspace mounted | Not yet | Browser tools/CLI boundary needs real profile check | Pending |
| `init --target` projection | Dry-run coverage exists; real local install not yet recorded; `codex` shorthand still needs product alias | Not applicable | Not yet | Bundle install path exists, real profile check pending | Pending |
| Runtime/Web startup | Existing source start launches Agent/WebUI and waits on fixed Web URL | Prior smoke loaded WebUI | Not yet | Not yet | Not confirmed |
| Browser bootstrap/binding | URL token exchange and URL scrubbing have unit coverage | Prior smoke showed `browserConnected=false` in one run; no current external tracer | Not yet | Not applicable | Not confirmed |
| `inspect → apply → run` | Dispatcher/Draft/Executor tests pass; no Native fallback in Agent source | Internal CLI/browser path exists from prior Goal | Not yet | Plugin path needs real profile | Pending |
| revision/client/project lock | Draft mutation checks and stale revision tests exist | Multi-tab/close/reconnect product smoke not recorded | Not yet | Native boundary only | Pending |
| disconnect/recovery | SSE reconnect code exists; scenario evidence missing | Refresh/close/runtime exit not executed this Goal | Not yet | Not yet | Pending |
| DSH install/boot/remove | Bundle build coverage exists | Not applicable | Not applicable | Real `dsh --profile` smoke pending | Pending |
| manual Workflow path | Existing editor tests/full suite pass | Prior visible smoke covered basic operations | Not applicable | Not applicable | Pending fresh regression |

## Audit findings

1. `tools/flovart/dev-commands.js` starts the source WebUI by polling `URLS.web` (`localhost:37522`) and emits only frontend/agent state; there is no single bootstrap coordinator or browser-connected readiness result.
2. `tools/flovart/local-agent.js` uses the same fixed default WebUI URL. Agent URL/token handling is centralized enough to reuse, but dynamic Vite port discovery and browser registration are not represented in the CLI result.
3. `services/agentConnectionBootstrap.ts` authenticates and scrubs bootstrap parameters; `WorkflowWorkspaceAdapter` then publishes the current project over SSE. Browser binding recovery and session identity still need explicit product-level orchestration.
4. `agent/session.js` has an explicit Native adapter, but its selection predicate still treats a missing browser as a reason to choose Native for non-Agent sources. P4 must narrow this to explicit Native/Headless mode only.
5. `initCliHost` writes real Skill files, but the public target vocabulary is currently `codex-skill`; P1 must accept the user-facing `--target codex` projection without adding a Host-specific Core branch.
6. The DSH package already has a build/profile installer and a CLI-only degradation path; P6 needs real isolated-profile evidence, not another Core abstraction.

## P0 decision

The existing contracts are reusable. Proceed with a small bootstrap/readiness seam, a target alias/projection install improvement, binding hardening, and product recovery UI. Do not add WorkBuddy to Director Binding, do not expand the five Agent tools, and do not create a second Workflow mutation or execution authority.

## Next action

P1: implement the Codex projection alias and run a safe real Codex CLI tracer bullet against the local CLI; then wire the external path to the browser bootstrap coordinator before claiming the Golden Path.
# First Run → First Safe Generation — latest status

## Current phase

U1 — Local Fake Provider Harness（首个可测试纵切已开始）

## U0 audit findings

- Fresh Browser Workspace 可以进入 `/app` 的 Workflow 空态，但首次运行的 Onboarding 状态此前只由 `useApiKeys` 设置，`App` 没有真正挂载 `OnboardingWizard`；本轮已接入挂载与“稍后再说”的跳过标记。
- 旧向导默认 Google 且把兼容服务地址藏在高级设置中；本轮已把首次配置默认改为 OpenAI-compatible，普通步骤只要求“服务地址 + API Key”，模型与能力仍放在高级设置。
- `validateApiKey` 已经通过真实 `/models` 返回模型与能力，但保存入口此前不会自动建立 Product Model → Provider Route 映射，首个生成会被迫进入模型映射；本轮新增 `mergeSuggestedProductRouteMappings` 并接入新增 Key 与后台模型刷新，保留已有显式映射。
- PromptBar 在没有 AI 服务时已有设置入口，但生成按钮同时被 disabled 且没有 setup CTA；这一项仍待下一条 vertical slice 修复并用浏览器验收。
- 自定义视频适配器当前走 `${baseUrl}/v2/videos/generations` 的异步统一接口；Fake Provider 必须同时覆盖 `/v1` 模型/图片端点与 `/v2` 视频提交、轮询和下载，以验证真实现有执行链，不擅自改成第二套 Provider authority。

## Product decisions

- 默认产品词使用“AI 服务”，普通首启不要求用户理解 Provider、Route Mapping、Adapter 或 CredentialRef。
- OpenAI-compatible Base URL + API Key 是首启最小配置；成功 `/models` 后自动发现模型，并只追加缺失的产品路由建议，不覆盖用户已有映射。
- 本轮 Fake Provider 使用真实 localhost HTTP transport，记录脱敏的 endpoint、请求类型、模型、提示词与引用摘要；不保存 raw API Key 或原始 multipart/base64。
- 真实付费 Provider、Codex 登录和 DSH 登录不作为本 Goal blocker。

## Changed files

- `App.tsx`：实际挂载首启向导并持久化跳过状态。
- `components/OnboardingWizard.tsx`：默认 OpenAI-compatible，服务地址进入主步骤，错误文案收敛为用户可理解的连接错误，复用验证返回的模型列表避免重复 `/models` 请求。
- `services/aiServiceSetup.ts`：新增只追加缺失产品路由的深模块接口。
- `hooks/useApiKeys.ts`：新增服务和后台模型刷新时自动合并产品路由建议。
- `tests/aiServiceSetup.test.ts`、`tests/onboardingWizard.test.tsx`：首启最小字段与自动路由回归。

## Verification

- `npx vitest run tests/aiServiceSetup.test.ts --no-file-parallelism --maxWorkers=1`：通过。
- `npx vitest run tests/onboardingWizard.test.tsx --no-file-parallelism --maxWorkers=1`：通过。
- 已按 Playwright skill 先执行 dev-server detection；检测器未识别现有 Vite 进程，但 `flovart status --json` 确认 WebUI `http://127.0.0.1:37522` 与 Agent `http://127.0.0.1:17373` ready，根页和 Hash `/app` 已完成 U0 可见性采样。尚未把采样误记为首生成通过。

## Unresolved risks / exact next step

1. 添加真实 Fake Provider server 与 recorder，先通过 `/models`、图片生成和错误模式的 HTTP integration test。
2. 修复 PromptBar 无服务时的明确 setup CTA，并补 Cost/Execution Gate 的公共接口测试，确保 gate 发生在 Provider HTTP 之前。
3. 再用隔离 Browser Context 跑 clean-state：添加 AI 服务 → 自动发现模型 → 创建图片节点 → PromptBar 生成 → fake artifact 回画布；随后补 I2I/I2V、失败/刷新恢复和 secret 静态/运行时审计。

# Master Launch Goal — latest status

## Current launch phase

`R0 — RELEASE TRUTH AUDIT` 已形成第一版证据矩阵；当前 `LAUNCH VERDICT: NO-GO`。R0 只建立事实与门禁，没有把未验证能力标记为完成。

## Architecture decisions

- `LAUNCH_GOAL.md` 叠加在既有 `GOAL.md` 之上：旧 Goal 继续记录 Canvas/Agent 收敛历史，新文件成为 Release Candidate → Production Launch 的稳定终点。
- Published `main`、本地已提交架构与当前 dirty working tree 必须分开审计；本地修好但尚未发布，仍不能算陌生用户拿到的产品已修好。
- 五个 model-facing tools 保持不扩张；`command.list/schema` 只做兼容发现/诊断。
- 保留当前 First Run/Fake Provider 未提交改动，并将 fake HTTP recorder 作为费用授权、幂等、wire payload、失败与 secret 测试的共同 harness。
- Tauri 私钥文件只检查了 Git 跟踪/忽略边界，没有读取内容；生产密钥所有权、保管与签名仍属于 External Certification。

## Modified files

- `LAUNCH_GOAL.md`：持久化 R0–R31、Autonomous DoD、External Certification 与 GO/NO-GO 规则。
- `RELEASE_TRUTH_MATRIX.md`：区分公开分支、本地源码和 working tree，记录 claim、证据、状态与 blocker。
- `HANDOFF.md`：追加当前 Master Launch Phase、R0 结论与下一动作。

## Evidence produced

- 公开 README/Quick Start 仍展示 `init --host`、正常路径 `command.list/schema`、`canvas.inspect` 与 command-queue/file-state 描述；本地实现已转向 `--target`、五工具表面、Browser authority 和自动 binding。
- `node tools/flovart/cli.js help` 正常，但标准 `--help` 返回 `CLI_FATAL`，命令被解析为 `..help`。
- `.agents/skills/flovart/SKILL.md`、`tools/flovart/skill/SKILL.md`、`skills/flovart/SKILL.md` 内容不一致，且打包安装选择 tools copy。
- `tools/flovart/shadow-runtime.js` 及其测试仍保留完整 file-state Workflow 实现；当前 public Workflow command 虽走 Browser Workspace，但必须继续证明该实现是否只有安全兼容 caller。
- 本地产品版本文件统一为 `0.3.2`；公开最新 Release 仍是旧 test artifact。
- Desktop publish workflow 没有把 unit/type/Rust/extension/DSH/E2E/migration/security/checksum/SBOM/attestation 组成不可绕过的 release law。
- `workflowDispatcher` 接受 `args.confirmed === true`；Browser bridge 会真实询问用户，但还需证明外部 Agent/CLI 是否可直接伪造该字段并触发 Provider 请求。

## Current blockers

- **P1:** 公开文档仍描述已退出主路径的架构。
- **P1:** 三份 Flovart Skill 没有同一事实源。
- **P1:** `--help` 不可用，发布流水线缺少完整门禁。
- **P1 claim drift:** Table、Plugin lifecycle、Codex/DSH/Pi 正式支持与当前安装器的公开成熟度超过已验证证据。
- **P0 candidate:** caller-controlled `confirmed:true` 可能绕过真人费用授权。
- **P0/P1 candidate:** 生成幂等 cache 仅在内存，刷新/重启 exactly-once 尚未证明。

## Tests / browser / failure injection

- R0 文档阶段只执行了 CLI help、registry/version、静态 caller/claim 搜索与公开页面核验；没有把既有 972-test 历史结果当作当前 working tree 回归。
- Browser First Generation、Provider wire recorder、重复提交与刷新/重启故障注入仍属于下一纵切，状态为 `NOT_VERIFIED`。

## Next action

先用现有 fake Provider recorder 写一个失败测试：外部 `workflow.node.run` 携带 `confirmed:true` 时必须仍然是 `CONFIRMATION_REQUIRED` 且 Provider submit count 为 0。若复现绕过，改为执行边界签发、作用域绑定、单次消费的 approval receipt；随后对 timeout/retry/double-click/refresh/restart 跑同一 recorder 幂等矩阵。完成后再收敛 Skill/CLI/docs truth source。

# First Run → First Safe Generation — U9 latest status

## Current phase

U9 — Final Autonomous Acceptance（本机自动验收完成；真实 Provider/Codex/DSH 登录仍为外部确认项）

## Product decisions

- 没有 AI 服务时仍进入可编辑 Canvas；生成时才要求添加 AI 服务。
- OpenAI-compatible 首次配置默认只要求服务地址与 API Key，成功后自动发现模型；列表不可用时允许手动模型。
- Graph、PromptBar、`@` 和素材库共用 Canonical Generation Input；I2I/I2V 不再静默退化为无引用模式。
- 外部生成必须通过人工 Execution Gate。调用方 JSON 中的 `confirmed: true` 不是授权，只有真实确认后由内部执行边界附加 capability。
- 视频 Provider task ID 在轮询前先写入 Workflow 持久状态；刷新只恢复原 task，重试沿用同一幂等身份。

## Changed files

- 首启与配置：`App.tsx`、`components/OnboardingWizard.tsx`、`components/home/ProductionSkillShelf.tsx`、`hooks/useApiKeys.ts`、`services/aiGateway.ts`、`services/productModelCatalog.ts`。
- 生成与恢复：`services/workflowGeneration.ts`、`services/providerGenerationAdapter.ts`、`services/workflowDispatcher.ts`、`services/browserAgentKernel.ts`、`services/workflowAgentBridge.ts`、`components/workflow/store.ts`。
- 安全与 CLI：`services/runningHubService.ts`、`skills/flovart/scripts/import-from-libtv.js`、`skills/flovart/scripts/import-from-runninghub.js`、`tools/flovart/cli.js`。
- 回归与文档：First Safe Generation / Fake Provider、Store、Dispatcher、Provider、Skill/UI 测试；`docs/adr/0068-first-safe-generation-boundaries.md`、pending-test、todo、README、CHANGELOG。

## Verification

- `npx vitest run --no-file-parallelism --maxWorkers=1 --reporter=dot`：143 个测试文件通过，998 passed，1 skipped（999 tests），退出码 0。
- CLI help 修复后的定向回归：`tests/flovartAgentKit.test.js` 7/7 通过；`node tools/flovart/cli.js --help` 返回正常 Commands 文本，不再产生 `CLI_FATAL`。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过（Vite 4303 modules；仅保留已有动态导入和大 chunk warning）。
- `npm run ext:build`：通过，生成 `dist-extension`。
- `npm --prefix dsh-plugin run build`：通过，loader contract verified。
- `Set-Location src-tauri; cargo test --all-targets`：通过，Rust 测试共 36 个通过。
- `git diff --check`：通过；仅报告脚本文件的 CRLF/LF 转换提示。
- 可见 Chromium + 真实 localhost Fake Provider：首启 Canvas/AI 服务配置通过；首次安全图片生成的拒绝 Gate 为 0 次提交，429 显示可重试中文错误，确认后成功；重复相同幂等请求 `replayedRequests=0`。
- 可见 Chromium 引用闭环：I2I 使用 `/v1/images/edits` 且 2 个引用到达 multipart；I2V 使用 `/v2/videos/generations` 且 1 个 `first_frame` 引用到达请求；Graph + `@` 重复引用去重；结果出现在画布。
- 可见 Chromium 刷新恢复：视频只提交 1 次、轮询 3 次、内容下载 1 次；刷新后继续原 `fake-video-1`，结果成功回画布。
- 可见 Chromium BYOK 失败：401、缺少 `/models`、错误地址、连接超时均显示可行动产品文案，无技术词泄露。
- 可见 Chromium 手动路径：新建 Workflow、添加文本节点、编辑、Undo/Redo、切换 Table、进入 Agent 工作区均通过；页面/控制台错误为空。旧 smoke 中的重复按钮和已删除 `.workflow-agent__status` 选择器已仅在临时测试脚本中修正，没有改产品语义。
- 浏览器证据：`C:\tmp\flovart-first-run-connected-20260830.png`、`C:\tmp\flovart-first-safe-generation-20260830.png`、`C:\tmp\flovart-prompt-reference-e2e-20260830.png`、`C:\tmp\flovart-video-refresh-recovery-20260830.png`、`C:\tmp\flovart-byok-unauthorized-20260830.png`、`C:\tmp\flovart-qa-core-agent.png`。

## Security review

- Fake Provider recorder 对 Authorization 只保存 `[redacted]`；运行日志不再输出 RunningHub 原始 URL/响应/错误对象。
- API Key 只在现有本地加密 Vault / 运行时最终 header 边界读取；不进入 PromptBar、Agent tool result、Workflow 节点、User Script mapping、诊断导出或 recorder。
- 普通产品界面已将本轮触达的 Provider/Adapter/Credential/Canonical 等实现词收敛到 AI 服务、模型、参考素材和生成；`Bridge` 仅保留 `#/dock` 开发者诊断面。
- 未发现 Browser → Native 的静默 fallback；无 Browser binding 的 Browser/Agent 操作仍显式失败，Native 仅在显式 workspace mode 使用。

## Remaining risks / exact next step

1. 真实 Provider credential、实际价格/账单、远端取消和视觉质量尚未验证；本轮只使用 fake HTTP，不应写成真实供应商通过。
2. Codex CLI 登录态新对话、DSH 登录态页面恢复/升级回滚/Authority transfer 仍需外部环境确认；不阻塞本轮 fake-provider DoD。
3. 发布总门禁仍需完成 docs-contract、发行包签名、NSIS clean install/upgrade、SBOM/attestation 及更广泛性能/可访问性/soak 验收。

# Release Candidate Hardening — latest status

## Current phase

`RC4 — Persistence Soak`（RC0–RC3 已完成本地证据，继续执行可靠性与发布门禁）

## Architecture decisions

- RC0 只清理了可确认属于自动化验收的 Vite、Playwright、临时 Edge 和 orphan Agent 进程；Codex/Playwright MCP 浏览器没有停止。
- 标准发布测试命令以 `npm test` 为准；单 worker 模式曾出现一次 `workflowImageTools` 15 秒超时，但该用例单文件及 20 次重复通过，不能把诊断模式异常写成业务通过。
- 文档中的 `command.list` / `command.schema` 只作为 bootstrap、兼容诊断和 debug 注册表；正常 Agent 面保持五个稳定命令。
- Workflow persistence 现在有版本 `1`、迁移前 backup key、旧项目字段归一化、未知插件节点保留和坏连线隔离；迁移异常发生在源数据替换前。
- 本地 NSIS 构建使用 `tauri.local.conf.json` 关闭 updater artifact 生成，不读取或使用生产 updater 私钥；生产签名仍是 RC13/外部门禁。

## Changed files

- `RC_BASELINE.md`：环境、进程/端口清理和质量门基线。
- `RC_INSTALLER_EVIDENCE.md`：当前工作树 NSIS 构建、哈希、隔离安装/启动/卸载证据。
- `scripts/check-docs-contract.mjs`、`tests/docsContract.test.js`、`package.json`：发布文档/CLI contract 自动检查。
- `.agents/skills/flovart/SKILL.md`、`tools/flovart/skill/SKILL.md` 与公开快速开始/架构/兼容命令文档：投影和发布词汇同步。
- `components/workflow/migrations.ts`、`components/workflow/store.ts`、`tests/workflowMigration.test.ts`、`tests/workflowStore.test.ts`：持久化版本迁移、备份和测试 fixture。
- `dsh-plugin/cordis.patch.yml`、`dsh-plugin/src/tools.ts`：明确 DSH 只派生五个稳定模型工具，不把 registry discovery 当模型 surface。

## Verification

- `npm test -- --reporter=dot`：143 个测试文件通过，998 passed、1 skipped（999 total），66.03s。
- `npm run docs:check` 与 `tests/docsContract.test.js`：通过，18 份文档/Skill 文件检查。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过，4303 modules transformed；保留既有动态导入/大 chunk warning。
- `npm run ext:build`：通过。
- `npm --prefix dsh-plugin run build`：通过。
- `cargo test --all-targets`：36 tests passed。
- NSIS：重新构建、隔离静默安装、桌面进程启动、关闭、卸载均 exit 0，临时目录已清理。
- Migration：旧 schema A/B、未知插件节点、坏连线、迁移异常前 backup、backup 写失败与真实 store rehydrate 均通过。

## Unresolved risks / exact next step

1. 还没有 RC4 30/30 restart/refresh persistence soak 的正式报告，也没有 100/300/500 节点 Canvas 真实 Chromium 证据。
2. Tauri release updater 尚未使用隔离 test key 完成 N→N+1、坏签名和中断更新验证；生产私钥/发布仍不得伪造通过。
3. 下一步建立确定性 persistence hash soak，再进入 Canvas stress、资源泄漏与性能基线；所有循环保留失败轮次和最终 hash。

# Release Candidate Hardening — RC5/RC7 update

## Current phase

`RC6/RC8 — Resource and accessibility audit`（RC5 Canvas stress 与 RC7 性能基线已完成，继续审计资源回收、键盘入口和安全边界）

## Architecture decisions

- Canvas 压测使用隔离 Chromium IndexedDB fixture 直接装载确定性 100/300/500 节点图；测量从真实页面 reload 到所有节点渲染完成，不把人工创建 500 节点的准备时间混入结果。
- 真实 UI 交互仍通过 Canvas 的可见 DOM/指针/键盘处理器完成；图片节点作为无编辑控件夹具验证选择、拖动、连线、删除、Undo/Redo、平移和缩放。
- 文本节点正文 textarea 拦截指针是编辑语义，不把它误判成 Canvas 渲染失败；该交互入口保留到 RC8/RC18 产品复核。
- 100 次 undo/redo 的语义 hash 排除单调递增的 objectVersion，保留 revision/版本递增不回退的并发安全约束。

## Changed files

- `RC_CANVAS_STRESS_EVIDENCE.md`：真实 Chromium 100/300/500 节点和 20 次 reload 证据。
- `tests/releaseCandidateCanvasStress.test.ts`：500 节点/499 边图结构、100 mutation → undo → redo 回环测试。

## Verification

- 可见 Chromium：100/300/500 节点全部按预期渲染；500 节点 load 2,365 ms，20 次 reload median 2,091 ms、p95/worst 3,059 ms，console/page errors 0。
- 可见 Chromium 交互：selection、drag、connection、delete、undo、redo、restore、pan、zoom 均完成；持久化位置与边数量符合夹具预期。
- Companion Vitest：500 节点/499 边结构通过；100 次确定性 mutation、100 次 undo、100 次 redo 后 graph hash 与最终值一致。
- `npx tsc --noEmit`：通过。

## Unresolved risks / exact next step

1. 文本节点需继续从用户角度确认“编辑正文”与“移动节点”的入口是否足够清晰；不应通过破坏 textarea 编辑语义解决。
2. 仍未完成 RC6 资源泄漏循环、RC8 键盘/焦点验收、RC9–RC12 安全/插件/Provider/Host chaos 和 RC13+ 发布链。
3. 下一步读取现有资源/弹窗/键盘测试，完成可访问性与资源回收的真实浏览器/定向回归，再进入威胁模型审计。

# Release Candidate Hardening — RC6/RC8 completion update

## Current phase

RC6 and RC8 are complete. Next phase is RC9 security and plugin isolation.

## Decisions

- The resource soak measures settled ownership by view: Workflow owns one media URL for the fixture; Table owns two because it renders both the selected preview and the source-list thumbnail. A transient 1 → 2 transition is expected asynchronous Table hydration, not a leak.
- Escape is a global dismissal affordance for Workflow toolbar overlays. Settings is now a labelled modal dialog with an explicit close button, initial focus, and a local Tab trap. Escape closes an open key form first and the settings dialog second.
- Canvas freeform drag remains spatial; the acceptance claim is limited to keyboard-accessible controls and the existing Delete/layer/inspector alternatives.

## Changed files

- `components/workflow/WorkflowToolbar.tsx`
- `components/SettingsPanel.tsx`
- `tests/workflowResourceResolver.test.ts`
- `RC_RESOURCE_EVIDENCE.md`
- `RC_ACCESSIBILITY_EVIDENCE.md`

## Tests and browser evidence

- `npx vitest run tests/workflowResourceResolver.test.ts tests/releaseCandidatePersistence.test.ts tests/releaseCandidateCanvasStress.test.ts`: 3 files / 8 tests passed.
- `npx tsc --noEmit`: passed.
- Visible Chromium accessibility smoke: 31 named controls, 0 unnamed; focus trap true; all overlay Escape checks true; 0 console/page errors.
- Visible Chromium resource lifecycle smoke: 30 Workflow → Table → Workflow cycles; settled Table count 2, settled Workflow count 1, no monotonic increase, 0 console/page errors.

## Unresolved risks

- OS-level retained-memory profiling is still pending; the browser object-URL ownership check is not a substitute for it.
- RC9–RC20 remain to be audited.

## Exact next step

Audit and test the secret boundary, localhost bridge authentication/origin/path handling, Rust IPC input validation, and plugin failure isolation before touching release/update automation.

# Release Candidate Hardening — RC9 security update

## Current phase

RC9 security boundary audit is complete for the currently testable local
surfaces. Continue with RC10 plugin failure isolation.

## Decisions and fixes

- Hub/Agent-provided Skill package entries now use the same canonical path and
  text-content boundary as locally scanned packages before installation.
- The install boundary rejects traversal/absolute/non-canonical paths,
  non-text extensions, duplicate paths, more than 512 entries, files over
  1 MiB, and packages over 4 MiB. Rejection happens before package-directory
  creation; post-create failures still remove the partial directory.
- `THREAT_MODEL.md` records the browser, Agent Bridge, DSH proxy, Runtime/IPC,
  Skill/plugin, secret, and release-artifact boundaries without moving any
  Host-specific logic into Workflow Core.

## Changed files

- `tools/flovart/skill-package.js`
- `tools/flovart/skill-registry.js`
- `tests/skillPackage.test.ts`
- `tests/agentSkillRegistry.test.ts`
- `THREAT_MODEL.md`
- `RC_SECURITY_EVIDENCE.md`

## Verification

- Skill/package security focused suite: 2 files, 15 tests passed.
- `npx tsc --noEmit`: passed.
- Existing Workspace, DSH proxy, extension, Agent session, Runtime control,
  and toolkit integrity tests remain the evidence map in
  `RC_SECURITY_EVIDENCE.md`.

## Unresolved risks / exact next step

- Production updater signature/attestation and real Provider/Codex/DSH account
  certification remain external gates.
- RC10 must exercise plugin install/enable/disable/update/rollback/uninstall,
  malformed manifests, unknown nodes, and renderer/provider failure isolation.

# Release Candidate Hardening — RC10 plugin update

## Current phase

RC10 plugin failure isolation is complete for the current in-process Node
Plugin SDK and declarative User Provider extension. Continue with RC11
Provider resilience soak.

## Decisions and fixes

- Node Plugin updates now retain a prior definition and expose explicit
  rollback; failed/invalid contracts do not create a registry entry.
- Plugin rendering, panel, and toolbar execution is mounted below a
  node-local React error boundary. One broken plugin node becomes an
  understandable placeholder while the rest of the Workflow stays usable.
- The Node Plugin SDK remains a trusted in-process surface, not a security
  sandbox. This is explicitly recorded in `THREAT_MODEL.md` and
  `RC_PLUGIN_EVIDENCE.md`; third-party plugin isolation is not advertised as
  stable.

## Changed files

- `components/workflow/nodePluginSdk.tsx`
- `components/workflow/WorkflowNode.tsx`
- `tests/nodePluginSdk.test.tsx`
- `tests/workflowEditor.test.tsx`
- `RC_PLUGIN_EVIDENCE.md`
- `THREAT_MODEL.md`

## Verification

- `npx vitest run tests/nodePluginSdk.test.tsx tests/workflowEditor.test.tsx tests/userScriptProviderAdapter.test.ts --reporter=dot`: 3 files / 52 tests passed.
- `npx tsc --noEmit`: passed.
- Renderer failure regression proves the real Workflow editor remains mounted
  and renders a node-local fallback.

## Unresolved risks / exact next step

- Provider extension lifecycle is register/unregister/clear today; a separate
  provider-plugin sandbox/permission model is intentionally not invented in
  this RC.
- Continue with Fake Provider 401/429/500/timeout/polling/refresh/restart
  resilience and duplicate-submit statistics in RC11.

# Release Candidate Hardening — RC11 provider update

## Current phase

RC11 Fake Provider resilience soak is complete. Continue with RC12 Host and
Browser chaos, then audit updater/CI/offline/diagnostics.

## Verification

- `tests/releaseCandidateProviderResilience.test.ts` runs a real localhost
  HTTP 30/30/20/20 soak: 100 successful logical generations, 100 submit
  requests, 0 duplicate submits, 30 I2I edit requests with references, and
  20 I2V requests with first-frame references.
- The same test proves a rate-limit failure followed by an explicit healthy
  retry remains visible and creates exactly two requests for two attempts.
- Existing fake integration covers unauthorized, 429, 500, malformed response,
  model-discovery timeout, polling timeout, and resume-existing-task without a
  second submission.

## Evidence

- `RC_PROVIDER_RESILIENCE_EVIDENCE.md`
- `tests/releaseCandidateProviderResilience.test.ts`

## Unresolved risks / exact next step

- This is local fake HTTP evidence only; real Provider pricing/billing,
  cancellation, account limits, and visual quality remain external.
- RC12 must inject Browser refresh/close, second tab, project switch, Runtime
  restart, Agent restart, and Host switch while asserting no wrong-target or
  duplicate generation write.

# Release Candidate Hardening — RC12 Host chaos update

## Current phase

RC12 Host and Browser chaos is complete for the source WebUI and local Agent
surfaces that are available in this environment. Continue with RC13–RC17
updater, artifact provenance, CI, offline, and diagnostics hardening.

## Verification

- Visible Chromium tracer bullet: two-tab Writer lock, first-tab close,
  recovery CTA, explicit `WORKSPACE_UNAVAILABLE`, recovery inspect, wrong
  project binding rejection, Claude Code Host activation, Codex revocation,
  unchanged active project, zero browser errors, and fixture cleanup all
  passed.
- The second tab did not include the launcher-only automatic Writer claim;
  the first tab remained the active Writer until it was closed.
- Existing startup/Agent restart and async-video refresh evidence is recorded
  in `RC_HOST_CHAOS_EVIDENCE.md`.

## Changed files

- `RC_HOST_CHAOS_EVIDENCE.md`

## Remaining risks / exact next step

- A desktop Runtime process-kill loop is not independently measured in this
  source-WebUI run; keep the existing bootstrap/restart evidence and do not
  claim full desktop Runtime chaos until a Runtime process is available.
- Proceed to inspect the real Tauri updater configuration, test-signing path,
  release workflow, offline shell, and sanitized diagnostics.

# Release Candidate Hardening — RC13–RC20 completion update

## Current phase

RC13–RC20 autonomous hardening is complete for the capabilities available
without real Provider/Codex/DSH accounts. The repository is ready for a final
release-candidate verdict after rebuilding the final local NSIS artifact.

## Decisions

- The production desktop workflow remains `.github/workflows/build-desktop.yml`.
  It stages only bundle installers, emits SHA256 checksums, generates a
  platform-specific SPDX SBOM with Anchore, and creates tag-only GitHub
  artifact attestations. The manual legacy workflow is not treated as the
  authoritative release gate.
- A test-only Tauri signing key was used in an isolated temporary config. The
  repository production public key/config and ignored local key files were not
  changed; production key ownership remains an external release check.
- Offline UX is a shell-level state: local project/assets/Canvas remain usable,
  while remote Provider, marketplace, and Agent work waits for recovery.
- Advanced Dock diagnostics are generated from an allowlisted DTO. They retain
  useful status/project/host fields but never serialize the connection token,
  query string, Provider credentials, or request bodies.
- The release red-team matcher treats client identity comparisons as valid
  binding logic and only rejects literal branches on known Host identities.

## Changed files

- `.github/workflows/build-desktop.yml`
- `.github/workflows/ci.yml`
- `scripts/run-critical-suite.mjs`
- `scripts/release-red-team.mjs`
- `services/supportDiagnostics.ts`
- `components/OfflineNotice.tsx`
- `components/AppShell.tsx`
- `components/dock/ProductionControl.tsx`
- `tests/offlineShell.test.tsx`
- `tests/supportDiagnostics.test.ts`
- `SUPPORT_MATRIX.md`
- `THREAT_MODEL.md`
- `RC_*_EVIDENCE.md`
- `README.md`, `README.en.md`, progress docs, and `CHANGELOG.md`

## Verification

- Full Vitest: `150` files, `1017 passed`, `1 skipped` (`1018` total).
- Critical suite: `10/10` repetitions; each repetition `9` files / `48` tests,
  total runtime `53.5s`.
- TypeScript: `npx tsc --noEmit` passed.
- Web build: passed; existing dynamic-import and large-chunk warnings remain.
- Browser extension build: passed.
- DSH plugin build: passed with client loader contract verification.
- Rust: `cargo test --all-targets` passed, `36` tests.
- Docs contract: `18` files checked.
- Release red-team: `ok=true`, zero failures, five public Agent commands.
- Visible Chromium offline smoke: editor remained visible while offline,
  recovery cleared the notice, and browser/page errors were zero.
- Local Tauri test-signing proof: valid signature accepted and tampered
  installer rejected. Local NSIS install/launch/uninstall proof is recorded in
  `RC_INSTALLER_EVIDENCE.md`.

## Remaining risks / exact next step

- Final local NSIS rebuild and isolated install/launch/uninstall smoke are now
  complete. The final test-signed package is `12,249,543` bytes with SHA-256
  `962D27A1B44FC0F56B82EBA47345B8F1A62F0BAA836FE22476CF634F815D74A9` and a
  416-byte updater signature; install/launch/graceful-close/uninstall all
  passed in a unique temporary directory, and the final signature verified
  while a one-byte tampered copy was rejected.
- A full installed N→N+1 updater run, production Authenticode, GitHub hosted
  SBOM/provenance, real Provider billing/cancellation, Codex login transcript,
  and DSH login are external gates and must not be reported as passed.
- The developer `node_modules` tree has existing Radix/React peer drift that
  makes `npm sbom --package-lock-only` reject locally; hosted release uses the
  independent Anchore scan after clean `npm ci`.

## Final RC handoff

The autonomous RC evidence is complete. Run the final plan/status update and
report `AUTONOMOUS RC: PASS` only for the locally verifiable scope; report
`PRODUCTION LAUNCH: NO-GO` until the external certification gates above are
performed with production-equivalent credentials and signing material.

## Closure verification

- `npm run docs:check`: passed, 18 files checked.
- `npm run release:red-team`: passed, zero failures and five public Agent
  commands.
- `git diff --check`: passed; only the existing LF/CRLF normalization warnings
  were emitted for progress docs.
- Final artifact status: NSIS `12,249,543` bytes, SHA-256
  `962D27A1B44FC0F56B82EBA47345B8F1A62F0BAA836FE22476CF634F815D74A9`, updater
  signature 416 bytes, no repository-related process or listener remains.

# Launch truth reconciliation and security automation continuation

## Current phase

R0/R15/R26 truth reconciliation and security automation are complete for the
locally verifiable scope. The launch verdict remains `NO-GO` because public
parity, real accounts, production signing and hosted release certification are
not local evidence.

## Decisions

- `RELEASE_TRUTH_MATRIX.md` now has a current working-tree reconciliation table
  and retains the pre-RC inventory as an explicitly historical snapshot.
- The three Flovart Skill projections remain byte-identical and are checked by
  docs-contract and release red-team automation.
- `npm run release:secret-audit` scans Git-visible tracked and non-ignored
  untracked files, redacts findings, and fails on high-confidence key/token
  patterns. It does not treat ignored local test signing keys as repository
  material.
- `.github/workflows/security.yml` is reusable by the tag release path and
  runs CodeQL for JavaScript/TypeScript and Rust, high-severity dependency
  review on pull requests, and the secret audit.
- `build-desktop.yml` runs a tag release gate, creates draft Releases, waits for
  the complete build matrix and artifact integrity steps, then finalizes from a
  separate publish job. The old manual `release.yml` is now a non-publishing
  redirect, so it cannot bypass the release law.

## Changed files

- `.github/workflows/build-desktop.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/security.yml`
- `.github/workflows/release.yml`
- `scripts/release-secret-audit.mjs`
- `scripts/release-red-team.mjs`
- `tests/runtimeAgentTextStream.test.ts`
- `package.json`
- `RELEASE_TRUTH_MATRIX.md`
- `LAUNCH_GOAL.md`
- `THREAT_MODEL.md`
- `SUPPORT_MATRIX.md`
- `RC_SECURITY_AUTOMATION_EVIDENCE.md`
- `docs/content/docs/progress/todo.mdx`
- `docs/content/docs/progress/pending-test.mdx`

## Verification

- Full Vitest: `150` files, `1017 passed`, `1 skipped` (`1018` total).
- TypeScript: `npx tsc --noEmit` passed.
- Web build: passed; existing dynamic-import and large-chunk warnings remain.
- Browser extension build: passed.
- DSH plugin build: passed with client loader contract verification.
- Rust: `cargo test --manifest-path src-tauri/Cargo.toml --all-targets` passed,
  `36` tests.
- Critical suite: `10/10`; each repetition had `9` files and `48` tests,
  completed in `45.0s`.
- Docs contract: passed, `18` files checked.
- Release red-team: passed, zero failures and five public Agent commands.
- Secret audit: passed, `910` Git-visible files scanned and zero findings.
- All workflow YAML files parsed successfully with the repository YAML parser.
- `git diff --check` passed; only the existing LF/CRLF normalization warnings
  for progress docs remain.

## Remaining risks / exact next step

- Run the hosted `security.yml` and tag `build-desktop.yml` once in GitHub to
  collect CodeQL, dependency-review, artifact-attestation and draft-finalize
  evidence. A workflow file is configured, not proof of a hosted run.
- Enable and verify GitHub secret scanning, push protection and branch rules in
  the release repository; these settings cannot be proven from source alone.
- Perform the external N→N+1 updater run, Windows Authenticode check, real
  Provider billing/cancellation test and logged-in Codex/DSH transcripts.
- Keep the accepted CSP tradeoff visible: arbitrary HTTPS is currently needed
  for user-configurable BYOK endpoints; narrowing it requires an approved
  provider proxy/security design.
- Do not publish, push, create production signing material or mark the launch
  `GO` from this workspace without the required owner authorization and
  external evidence.

# Final Release Candidate Certification

## Current phase

Final RC certification is complete for the locally controllable scope. The
clean detached source candidate is
`27c81ad3f5c3a5c69c463aa90e724d2002c8300c`; the review base and `origin/main`
remain `9a1534b035350152c87d93a5f6e07f7452f3f66f`. No push, tag, GitHub Release,
production signing key, or real paid Provider call was performed.

## Release truth decisions

- `VERSION`, root/package-lock/package versions, CLI package, Tauri config and
  Cargo package are aligned at `0.3.2`; DSH remains independently versioned at
  `0.1.0`.
- The updater endpoint is owned by `avabbbb/Flovart`; version and retired-owner
  checks are enforced by `npm run version:check`.
- Public documentation now uses `--target`, `status → start --open when needed
  → workflow.inspect`, and the five-command Agent surface. `command.list` and
  `command.schema` are discovery/diagnostic paths only. The docs checker scans
  Git-visible documentation rather than a fixed file list.
- Desktop release workflow publication is draft-first. Manual dispatch defaults
  to `publish=false`; the legacy release workflow is non-publishing.
- DSH dependency loading is optional and isolated to its Plugin projection; a
  clean root checkout no longer fails merely because `@deepseek-ai/dsh-tools`
  is absent.

## Final candidate verification

- Clean `npm ci` and `npm --prefix dsh-plugin ci` passed; existing peer-resolution
  warnings are emitted by the dependency tree but do not fail installation.
- `npm run version:check`, `npm run docs:check`, `npm run release:red-team`,
  `npm run release:secret-audit`, and `git diff --check` passed. The clean
  candidate docs check reported `131` files; the review worktree reported `132`
  because its ignored generated Skill copy was present. Secret audit scanned
  `914` Git-visible files with zero findings.
- Full Vitest: `150` files, `1017 passed`, `1 skipped` (`1018` total).
- TypeScript, Web build (`4306` modules), Browser Extension build and DSH build
  with client-loader contract all passed.
- Rust `cargo test --manifest-path src-tauri/Cargo.toml --all-targets` passed
  with all `41` tests green under `CARGO_BUILD_JOBS=1`.
- Critical suite: `10/10`; each repetition had `9` files and `48` tests.
- `npm pack ./tools/flovart` passed at `flovart-cli@0.3.2`, producing a package
  with `66` files and the bundled Skill projections.

## Windows installer evidence

- Final local NSIS: `Flovart_0.3.2_x64-setup.exe`, `12,252,087` bytes,
  SHA-256
  `63381D17A78A10083F46671954C7DFBE73A5C1F8042ACD0E53288C2518898937`.
- Isolated smoke installed with exit `0`, launched the real `flovart.exe`,
  closed gracefully, uninstalled with exit `0`, and removed the install root.
- This is a local unsigned/AuthentiCode-free RC package; production Windows
  signing remains external.

## Updater evidence

- A disposable test-signed N `0.3.1` installer and N+1 `0.3.2` installer were
  served through an isolated HTTPS fixture. The installed N app downloaded,
  replaced itself and relaunched as N+1.
- A one-byte tampered N+1 payload was rejected; the installed app stayed at
  `0.3.1` and no replacement process appeared. The signed payload was restored
  and its feed signature match rechecked.
- The fixture did not contain a project, so project/asset preservation across
  update is not claimed by this evidence. Full details are in
  `RC_UPDATER_EVIDENCE.md`.

## External gates

- Hosted GitHub CI/security/release execution and repository security settings
  were not run against this unpushed candidate.
- Production Tauri updater/AuthentiCode signing key custody and public feed
  publication remain pending.
- Real Provider model, billing, cancellation and account behavior remain
  pending; Fake Provider evidence is not promoted to a real-provider pass.
- Real logged-in Codex certification remains pending. DSH stays Experimental
  until its authenticated lifecycle is certified.

## Exact next step

Push the reviewed candidate only after owner approval, run the hosted security
and draft release workflows on that exact SHA, then perform the external
Provider/Codex/signing gates. Keep `PRODUCTION LAUNCH: NO-GO` until those
evidence packages exist.

## Release artifact verification continuation

### Current phase

The release candidate workflow now has a content-level artifact gate in
addition to the existing release red-team markers. The checker validates
installer version names, exact checksum coverage and digest matches, and
validates the supplied SPDX JSON document when the hosted job passes
`--sbom`.

### Verification

- `npx vitest run tests/releaseArtifactCheck.test.js --reporter=dot`: 2/2
  passed, including tamper rejection.
- The final local NSIS checksum (`Flovart_0.3.2_x64-setup.exe`, 12,252,087
  bytes) passed the same validator with zero errors.
- `release:red-team`, `version:check`, `docs:check` and
  `release:secret-audit` remain green after the workflow change.

The local installer does not contain a generated Syft SBOM; the hosted
workflow is the authoritative SBOM/provenance gate and has not been run on the
unpushed reviewed candidate. No production signing or publication was done.

### Exact next step

Recreate the clean detached candidate including this artifact-gate change,
rerun the release checks that bind evidence to its SHA, then—only with owner
approval—run the hosted draft release workflow on that exact SHA.

# Final Release Candidate Certification — final clean candidate

## Current phase

The final local review candidate is clean detached commit
`b7ba494b1d7d542d12f00d3f5711a43e3d5eb1b1` in
`C:\\Users\\ava\\AppData\\Local\\Temp\\flovart-rc-candidate-f46b418215ba44c1a083da5dbfa80b9c`.
It is derived from review base
`9a1534b035350152c87d93a5f6e07f7452f3f66f1`; neither this candidate nor the
working-tree changes were pushed, tagged, or published.

## Final clean-candidate evidence

- `npm ci` and `npm --prefix dsh-plugin ci` passed.
- Full Vitest passed: `151` files, `1019` passed, `1` skipped (`1020` total).
- `npm run test:critical` passed `10/10`; every repetition had `9` files and
  `48` tests (`35.1s`).
- `npx tsc --noEmit`, Web build (`4306` modules), Browser Extension build, DSH
  build/client-loader contract and Rust `cargo test --all-targets` (`41` tests)
  passed.
- After `npm pack ./tools/flovart`, `docs:check` checked `133` documents;
  `release:red-team`, `release:secret-audit` (`917` files, zero findings),
  `version:check` and `release:artifacts:check` passed. The packaged Agent
  setup guidance no longer points at file-state runtime.
- Final clean-candidate NSIS build passed with
  `Flovart_0.3.2_x64-setup.exe`, `12,254,279` bytes and SHA-256
  `41D9178E515F5C2C33BFC5977E73FC12263E22292F829139E7DD746DA3EBC194`.
  Isolated install, real `flovart.exe` launch, graceful close and uninstall
  all returned success; the temporary install root was removed.
- The artifact checker validates the same installer and checksum with zero
  errors; the local package intentionally has no Syft SBOM.

## Honest release boundaries

- The installed N→N+1 test updater and invalid-signature rejection remain
  valid local evidence from the preceding candidate `27c81ad…`, but the
  fixture did not seed project data and is not promoted to an exact final-SHA
  data-preservation PASS.
- Packaged Tauri UI first-generation automation could not be independently
  driven through WebView2 DevTools in this environment; browser/Fake Provider
  E2E and packaged install/launch are separate positive evidence. This is not
  a reason to alter Workflow or Provider authority.
- GitHub-hosted CI/security/SBOM/provenance has not run against the unpushed
  candidate. Repository security settings, production updater/AuthentiCode
  signing, real Provider billing/cancellation and logged-in Codex/DSH flows
  remain external gates.

## Exact next step

After owner approval, push this reviewed source, run the hosted security and
draft release workflows against the exact SHA, then execute the external
Provider/Codex/signing certifications. Keep `PRODUCTION LAUNCH: NO-GO` until
those evidence packages exist; do not start another architecture rewrite.

# Final RC Certification — dependency security closure

## Current phase

The source candidate `52b7e51e7fdd1094b98b88a173b8b7111fb03d12` is the latest
clean detached build candidate. This pass made no Host, Workflow, PromptBar or
Provider architecture change; it closed the remaining locally actionable npm
dependency audit finding and added that audit to the reusable Hosted security
workflow.

## Changes

- Confirmed that the current source tree does not import
  `@huggingface/transformers` or `@excalidraw/excalidraw`; removed both unused
  production dependencies and their transitive vulnerable trees.
- Updated direct `nanoid` and `react-router` constraints and re-resolved the
  compatible dependency graph without `npm audit fix --force`.
- Added `npm run release:dependency-audit` and a clean-install official npm
  registry audit job to `.github/workflows/security.yml`.
- Moved the completed dependency-security item out of the release todo and
  recorded the exact evidence in `RC_DEPENDENCY_AUDIT.md`.

## Verification

- `npm ci --ignore-scripts --registry=https://registry.npmjs.org`: passed;
  `586` packages added and `587` audited.
- Full official-registry `npm audit --audit-level=high`: `0 vulnerabilities`.
- Runtime-only official-registry `npm audit --omit=dev --audit-level=high`:
  `0 vulnerabilities`.
- Full Vitest: `151` files, `1019` passed, `1` skipped (`1020` total).
- TypeScript, Web build (`4306` modules), extension build, DSH build and Rust
  tests (`41`) passed; critical suite passed `10/10` (`9` files/`48` tests per
  repetition).
- Docs contract checked `134` documents; version check, release red-team and
  secret audit (`918` files, zero findings) passed.
- Rebuilt NSIS from the candidate: `Flovart_0.3.2_x64-setup.exe`,
  `12,248,162` bytes,
  SHA-256 `B780E378C16E48CEA058316F658CB594641F832335C7611011572164AB8ACB22`.
  Isolated install, real executable launch, graceful close, uninstall and
  artifact checksum verification all passed.

## Remaining boundaries

- The candidate remains detached and unpushed; no Hosted GitHub run or
  repository-setting change is claimed for this SHA.
- Production updater signing/AuthentiCode, clean-machine data-preserving
  N→N+1 certification, real Provider billing/cancellation, and logged-in
  Codex/DSH certification remain external gates.
- `PRODUCTION LAUNCH: NO-GO` remains the correct verdict until those external
  gates are completed. Do not begin another architecture rewrite for these
  items.

## Exact next step

After explicit owner approval, publish this source candidate, run the Hosted
security and draft release workflows against the exact pushed SHA, then attach
the real Provider/Codex/signing evidence. Keep the local candidate and its
evidence available for comparison during that external certification.

# Final RC certification continuation — packaged update preservation

## Current phase

The temporary updater probe is complete and removed. The candidate source is
restored to the formal `0.3.2` release configuration: the production
`avabbbb/Flovart` updater endpoint, production-configured public key, normal
window title, and the existing startup auto-check path. No test key,
loopback endpoint, TLS exception, or debug UI remains in the source tree.

## New evidence

- The final restored candidate NSIS package is
  `Flovart_0.3.2_x64-setup.exe`, `12,248,835` bytes,
  SHA-256 `53B7BD71D2FB1E35EB2A57347EBA0C7AD111EDD101FBB0F4360FF942D9436AD8`.
- Its isolated NSIS smoke returned install `0`, observed the real
  `flovart.exe`, closed gracefully, returned uninstall `0`, and removed the
  temporary install root.
- A disposable test-signed `0.3.1` installation updated through the real
  Tauri updater path to `0.3.2`. The feed recorded metadata, installer
  download, and post-relaunch metadata requests. A seeded project container
  remained visible as `本地项目 1` after relaunch.
- The exact update hashes, runner result, and honest process-observation
  limitation are recorded in `RC_UPDATER_EVIDENCE.md`; this is an
  application-level preservation pass, not production signing or cross-schema
  migration certification.

## Verification after cleanup

- `npm run version:check`: pass, `0.3.2` / `avabbbb/Flovart`.
- `npm run docs:check`: pass, `134` documents.
- `npm run release:red-team`: pass, five public Agent commands and no local
  signing files.
- `npm run release:secret-audit`: pass, `918` files and zero findings.
- `git diff --check`: pass.
- `npm run tauri:build`: pass; final local NSIS rebuilt from the restored
  configuration.
- The main developer checkout still contains the two ignored paths
  `src-tauri/.tauri_private_key` and `.pub`; their contents were not read or
  copied. They are not in the clean candidate and must be treated as external
  signing material, not as repository evidence.

## Remaining risks / exact next step

- The candidate remains local and unpushed; Hosted GitHub workflow execution,
  repository security settings, production updater/AuthentiCode signing and
  public feed publication are not claimed.
- Real Provider billing/cancellation behavior and logged-in Codex/DSH
  certification remain external.
- The update preservation fixture uses the same schema on N and N+1, so a
  cross-schema production migration and interrupted packaged migration remain
  separate gates.
- Run the final local regression against this restored source, then—only with
  owner approval—run the Hosted draft-release/security workflows on the exact
  published SHA. Keep Production Launch `NO-GO` until every external gate has
  evidence.

## Hosted failure reconciliation

Read-only `gh` inspection found the latest workflow-bearing `main` SHA
`9a1534b035350152c87d93a5f6e07f7452f3f66f1` had Security green, Critical 10x
green, CI failed in Docs contract, and Build Desktop ended in
`startup_failure` with no jobs. The CI log identified the old checker requiring
the ignored `tools/flovart/skill/SKILL.md`, while the local candidate checker
now makes that generated copy optional. A clean dependency-installed detached
checkout confirmed `docs:check` and red-team pass without the generated copy.
The Build Desktop validation annotation also reported that the reusable
security job requested `pull-requests: read` while the caller granted
`pull-requests: none`; the candidate now grants that permission explicitly and
the red-team check guards it. The candidate workflow/dependency fixes are not
Hosted-certified until this candidate is published; no rerun, push, tag, or
release was triggered here.

Remote `main` has since advanced to `969478db26e7f55668bcb3a782e58962fe0f3f47`
through the scheduled traffic snapshot, which changes only `stats/history.json`;
no new RC workflow result is attached to that generated commit.

## Final local certification closure

- Final clean detached evidence candidate: `835c0ba1ba673760fc64e77aee92b2b3d15ad5b2`.
- The application/release-workflow source used for the final package is clean
  commit `ea0b78d26ddf00fdba590098a99c678c12db8efe`; later candidate commits
  only update release evidence documents.
- Post-commit gates passed again: version `0.3.2` / `avabbbb/Flovart`, docs
  contract (`134` files), red-team (five Agent commands, zero failures), secret
  audit (`918` files, zero findings), full Vitest (`151` files; `1021` passed,
  `1` skipped), typecheck, Web/Extension/DSH/Rust builds, dependency audits,
  exact NSIS checksum verification and diff check.
- Final NSIS evidence: `12,245,646` bytes,
  SHA-256 `D7502F44DA03064FA03BACE39BDBBDEA2E267294D5F2C787606F59D4760D2F63`;
  isolated install, launch, graceful close and uninstall passed.
- Local test-signed updater evidence includes the current signed
  project-container-preservation update and current invalid-signature rejection;
  migration tests also cover truncated-envelope recovery. This does not
  certify the production key, public feed, or cross-schema/interrupted migration.
- No push, tag, release, Hosted rerun, production signing, paid Provider call,
  or Codex login was performed. The exact next step is owner-approved Hosted
  execution against this SHA, followed by external Provider/Codex/signing
  certification.

## Hosted attestation permission review

The current GitHub `actions/attest@v4` contract requires
`artifact-metadata: write` in addition to `id-token: write` and
`attestations: write`. The desktop workflow now grants the missing permission,
and `release:red-team` asserts all three before a Hosted run. This was a local
workflow hardening change; the exact candidate still needs one Hosted execution.

## Clean candidate artifact closure

- Rebuilt the current detached candidate after `npm ci --ignore-scripts`:
  `Flovart_0.3.2_x64-setup.exe`, `12,247,847` bytes, SHA-256
  `E7FB4E01CF9A4C0F5A3D486B0C44B2938501019D292EC4D2C14E454D27AFD469`.
- The current artifact passed the isolated NSIS install/launch/graceful-close/
  uninstall smoke and `release:artifacts:check` with zero errors.
- A local npm SPDX-2.3 package-lock SBOM passed the same checker with 663
  packages and 1,377 relationships. This does not replace Hosted Syft or
  provenance attestation evidence.
- No source architecture changed in this closure. The candidate remains
  unpushed; Hosted CI, repository security settings, production signing,
  real-provider and Codex certification remain explicit external gates.

## Packaged migration probe closure

A disposable test-only seeder NSIS package wrote a resource-rich version-0
envelope through IndexedDB using the same installed WebView2 runtime as the
candidate. The production candidate NSIS package then launched against that
same disposable `UserDataFolder`; a second seeder launch read the migrated
state. The report was `seed(version=0)` followed by `read(version=1)`, with the
project title, two node IDs and migrated widths, connection, provider metadata,
generation history, and asset ID preserved. The production installer exited
`0` and its launch was observed.

This closes the normal packaged cross-schema migration evidence gap without
changing production source or runtime configuration. The seeder, report
server, temporary profile/installers, and test-created WebView2 policy value
were cleaned up. A process kill during the migration write itself remains
`NOT VERIFIED`; deterministic backup recovery tests cover the source-level
failure boundary. The next authoritative step remains owner-approved Hosted
execution against the clean candidate, followed by external Provider, Codex,
and production-signing certifications.

## Updater interruption evidence closure

The disposable test-signed N installation was exercised against a slow local
HTTPS updater feed. The real update control requested the N+1 installer, the
exact N process was terminated during the download, and the installed version
remained `0.3.1`. A subsequent normal launch requested the feed and installer
again and completed the replacement at `0.3.2`. The harness result was
`nVersionAfterInterrupt=0.3.1`, `nPlusOneVersionAfterRetry=0.3.2`, with both
slow and retry requests observed. This closes the interrupted updater-download
scenario locally; it does not certify a process kill during migration writes,
production signing, a public feed, or Hosted provenance. Evidence is recorded
in `RC_UPDATER_EVIDENCE.md`.

## Critical-suite stability recheck

The latest clean-candidate default-parallel critical run completed
`20/20` repetitions, with `9` files and `50` tests passing in each repetition
(`68.8s`). The focused rate-limit test completed `20/20`, and a serial version
of the same nine-file suite completed `10/10`. One earlier parallel attempt
had a transient connection-error classification in the rate-limit assertion;
it did not reproduce in the higher-count rerun and no source change was made.
This is recorded in `RC_CI_EVIDENCE.md`, not represented as a Hosted CI pass.

## Post-workflow-fix artifact closure

The release workflow hardening commit
`491970e5345523bc7ca0223f18d773a978b6a014` makes non-tag desktop dry runs use
the unsigned local Tauri overlay while tagged builds continue to use the
production updater configuration and version gate. A local probe of the
production configuration without `TAURI_SIGNING_PRIVATE_KEY` stopped at the
expected signing boundary; it did not weaken the production requirement.

The rebuilt candidate NSIS artifact from packaged candidate commit
`a7d4d5b6cc650c9746886a7e2a5ef780f43919b5` is
`Flovart_0.3.2_x64-setup.exe`, `12,249,424` bytes, SHA-256
`849B9EF771F16957EB334CD21BE194587BACF79D615D0BFE5903B3B882D8EC71`.
The latest isolated smoke installed it with exit `0`, observed the real
`flovart.exe`, closed it gracefully, uninstalled with exit `0`, and removed
the temporary install root. The staged artifact, checksum manifest, and local
SPDX SBOM passed `release:artifacts:check` with zero errors. The candidate
remains unpushed and Hosted CI/provenance, production signing, real Provider,
and real Codex certification remain external gates.

## Packaged UI generation observation boundary

The latest isolated NSIS package was also installed with a local Fake Provider
running. The installed app remained alive, but the WebView2 runtime exposed no
usable CDP endpoint on the test debug port after 30 connection attempts, so no
automated UI assertion or Provider request was made from that installed window.
This is `NOT_VERIFIED` for the packaged full-generation path, not a product
failure and not a substitute for the already passing source WebUI/Fake Provider
E2E. The test app, provider, profile and temporary files were cleaned up; no
production process or user data was touched.

## Exact-source installer rebuild

The latest clean-candidate source at `68865e7c3a0b674adf7118860d8a0afba132f237`
was rebuilt with the unsigned local Tauri configuration. The resulting NSIS
package is `Flovart_0.3.2_x64-setup.exe`, `12,245,884` bytes, SHA-256
`12C7802F9CEDB2FE05B646251959A5B1BAC33F77237A458D13741532B170D426`.
The staged checksum and local SPDX SBOM passed `check-release-artifacts` with
zero errors. This is the current artifact identity; earlier hashes in this
append-only handoff are historical rebuilds.

## Final exact-source gate recheck

The clean application/package source was `68865e7c3a0b674adf7118860d8a0afba132f237`;
the clean evidence candidate at capture was `697a77c4a65455ffc7967b448ccf6f0ddd6bcf26`.
The final recheck passed Vitest (`151` files, `1,021` passed, `1` skipped),
TypeScript, Web build (`4,306` modules), Extension build, DSH build, Rust
`--all-targets` (`41` tests), and the official-registry npm audit (`0`
vulnerabilities). Docs contract (`134` files), version parity, tag-version,
red-team, secret audit, staged NSIS/SHA256/SBOM verification, and `git diff
--check` also passed. The exact-source NSIS artifact is
`Flovart_0.3.2_x64-setup.exe`, `12,245,884` bytes,
`12C7802F9CEDB2FE05B646251959A5B1BAC33F77237A458D13741532B170D426`; its
isolated install/launch/close/uninstall smoke passed. Hosted execution,
production signing, real Provider/Codex certification, packaged UI generation
observation, and process-kill-during-migration-write remain explicitly
unverified or external as described above.

## Desktop WebView generation fix and current artifact

The source-identical candidate commit `ce0c235` fixes packaged WebView2
generation when a provider returns a `data:` image URL. Tauri CSP allows the
image to render but does not allow `fetch(data:...)`; the generation path now
decodes data URLs directly to a Blob and retains fetch for ordinary remote URLs.
Focused media/generation regression tests passed (`55/55`).

The exact clean candidate was rebuilt with `src-tauri/tauri.local.conf.json`.
The current NSIS package is `Flovart_0.3.2_x64-setup.exe`, `12,246,944` bytes,
SHA-256 `17FF507822D8A9A0D469FF3C382A6F4AB4CC85154CAA30B791237F7B3FCD2F24`.
The isolated installer smoke passed install, launch, graceful close and
uninstall; the package is unsigned by design. The staged checksum/SBOM bundle
at `C:\\tmp\\flovart-rc-artifacts-clean-candidate-20260902-v3` passed
`check-release-artifacts` with zero errors.

A temporary CDP-only Tauri overlay, with the same application source and only
an extra WebView2 debugging port, was used to observe the installed app
complete Fake Provider T2I. The request, artifact persistence and successful
node state were observed in the packaged WebView. Exact formal-package
generation observation still lacks an approved external harness; this is kept
as a boundary rather than promoted to a formal package PASS. Process-kill
during migration writes also remains `NOT_VERIFIED`.

## CodeQL alert reconciliation and current candidate

On 2026-09-02 the public GitHub code-scanning API was read without changing
repository state. It reported 13 open alerts, all on older `main` SHA
`9a1534b035350152c87d93a5f6e07f7452f3f66f1`: 1 critical, 9 high and 3 medium.
The candidate source already changed the old URL, stack-trace, XSS, generated
source quoting, identity replacement and randomness sites; it also now bounds
the topic-research artifact key to 4096 characters and uses an ASCII scan.
The critical DSH proxy alert is not declared closed because its fetch target
still derives from launcher configuration even though loopback, route and
token guards are present. The complete disposition is in
`RC_CODEQL_TRIAGE.md`; Hosted CodeQL must run on the exact pushed candidate.

The source-security change is clean commit
`1444453597e2cb9c7c5a3867f406e33391cd4a3a`. It was rebuilt as
`Flovart_0.3.2_x64-setup.exe`, `12,247,499` bytes, SHA-256
`2DE7DF820459F681521D99EBBA4D6D4E18ACE645E8DF95821166E44D4F7AD26F`.
Staged checksum/SPDX verification and isolated NSIS install, launch, graceful
close and uninstall passed. The focused topic-research regression is `5/5`.

The candidate remains detached and unpushed. Local security checks are green,
but Hosted CodeQL, repository security settings, production signing, public
release publication and real Provider/Codex certification remain external.

## Packaged migration crash recovery closure

- A source-identical instrumented NSIS package used an isolated WebView2 profile
  and CDP-only IndexedDB hook to terminate the exact Flovart process tree after
  the migration backup write and after the replacement current-envelope write.
- Both restarts completed version-0 → version-1 migration and preserved
  migration-crash-project / migration-crash-node; taskkill returned status 0
  for both phases. This closes the previously unverified local failure-injection
  boundary for a packaged WebView2 test build.
- This remains local evidence only: production Authenticode/updater signing,
  Hosted release execution, and clean-machine production-key certification are
  still external.

## Final RC candidate security closure (2026-09-02)

### Current phase

Final Release Candidate Certification: local source, artifact and security
hardening recheck. The candidate remains detached and unpublished.

### Architecture decisions

- DSH Workspace proxy targets are now restricted to an explicit-port
  `http://127.0.0.1` origin. The outbound URL is rebuilt from a fixed loopback
  literal; only the allowlisted route/method and owned status query fields are
  forwarded, and the Workspace token remains host-side.
- Desktop workflow permissions are least-privilege by job: read-only global
  permissions, with release artifact/attestation/finalization writes scoped to
  the jobs that require them. This does not change Workflow, Provider or Agent
  authority.

### Changed files

- `dsh-plugin/src/workspaceProxy.ts`
- `tests/dshWorkspaceProxy.test.ts`
- `scripts/release-red-team.mjs`
- `.github/workflows/build-desktop.yml`
- `RC_CODEQL_TRIAGE.md`
- RC evidence and progress documents updated to the current candidate anchor.

### Verification

- DSH proxy focused suite: `2/2`.
- DSH build and client loader contract: pass.
- `docs:check`: `135` files, pass.
- `release:red-team`: pass, including parsed workflow permission scope.
- `release:secret-audit`: `919` files scanned, `0` findings.
- `version:check`: `0.3.2`, owner `avabbbb/Flovart`, pass.
- Rebuilt NSIS candidate from `af1cae95faa171f4016c2bcf7c3381f007b05067`:
  `Flovart_0.3.2_x64-setup.exe`, `12,248,576` bytes,
  SHA-256 `063E89817C7F3900204409054B8CB089123CCA86C57CDDBB60142CC9FC1BDCB7`.
- Artifact checksum/SBOM checker and isolated install, launch, graceful close
  and uninstall smoke: pass.

### External gates still open

- The exact candidate still needs a Hosted GitHub CI/CodeQL/release dry-run;
  the old public main snapshot has 13 CodeQL alerts, including one critical
  DSH proxy alert, and this local hardening is not a Hosted closure.
- Production Tauri signing/Authenticode, public updater feed, repository
  security settings, real Provider billing/quality and real Codex login remain
  external certification gates.

### Exact next step

After owner-approved publication of this candidate, run the Hosted security and
desktop workflows on the exact SHA, then update `RC_CODEQL_TRIAGE.md`,
`GITHUB_REPOSITORY_SECURITY_CHECKLIST.md` and `RELEASE_TRUTH_MATRIX.md` from
the resulting run IDs. Do not call the production launch GO until external
Provider, Codex and production-signing evidence is attached.

## First-user generation and public-doc closure

### Current phase

Final Release Candidate Certification: public documentation parity and visible
first-user generation recheck. The candidate remains detached and unpublished.

### Changes

- `App.tsx` now resolves dotted translation paths such as
  `promptBar.generate`, so nested product copy is rendered instead of leaking
  an implementation key into button labels and tooltips.
- `README.en.md` and `docs/overview/quick-start.en.md` now describe the real
  `/#/app` first-run route, optional onboarding, “Add AI service”, minimal
  service-address/API-Key setup, automatic model discovery and Advanced-only
  capability declarations.
- The Chinese Quick Start, install guide and docs contract already carry the
  matching first-run path; the docs checker discovers Git-visible Markdown and
  MDX rather than relying on a fixed file-count allowlist.

### Verification

- `npx tsc --noEmit`: pass.
- Workflow node overlay regression: `27/27`.
- `npm run docs:check`: `135 files`, pass.
- `npm run version:check`: `0.3.2`, `avabbbb/Flovart`, pass.
- `npm run release:red-team`: pass.
- Visible Chromium fresh-context smoke with local Fake Provider: pass. It
  opened `/#/app`, left Canvas editable before setup, connected with service
  address + API Key, discovered models, showed one Chinese cost confirmation,
  rendered one image artifact, and observed one generation POST with zero page
  or console errors. The sanitized evidence is
  `C:\tmp\flovart-c14-first-user-evidence.json`; screenshots are
  `C:\tmp\flovart-c14-first-run.png` and
  `C:\tmp\flovart-c14-first-generation.png`.

### Exact next step

The NSIS candidate has now been rebuilt from the committed source containing
the nested translation fix. The package hash/version evidence and isolated
installer lifecycle smoke are current; next run the full local quality gate.
Hosted CI, CodeQL, production signing, real Provider and real Codex
certification remain external.

## NSIS rebuild after first-user fix

- Application source: `18b317348d0c32720b10b59c0f8e5450c239ce10`; package commit:
  `e080a08387644d2fcc4a46a5e7dad5a9ce65273e`.
- `npm run tauri:build` with `src-tauri/tauri.local.conf.json` completed a
  real Windows x64 NSIS build.
- Package: `Flovart_0.3.2_x64-setup.exe`, `12,249,655` bytes,
  SHA-256 `827AF318C965542372B018C8D851F127C15CB80FC365182EACEC39B7ABE8D86D`.
- `npm run release:artifacts:check -- --artifact-dir ... --sbom ...` passed
  with zero errors after the checksum manifest was aligned to the checker’s
  basename contract.
- `release-installer-smoke.ps1` passed silent install, real executable launch,
  graceful close, uninstall and removal of the temporary install directory.
- This is an unsigned local RC package; production Authenticode, updater
  signing, Hosted provenance and public publication remain external.

## Nested DSH dependency audit closure

### Current phase

Final Release Candidate Certification: clean-source dependency security
recheck.

### Changes

- Updated `dsh-plugin`'s direct `esbuild` build dependency and lockfile from the
  vulnerable `0.21.x` line to `0.28.2`.
- Added nested DSH dependency audits to both CI jobs and the hosted Security
  dependency-audit job.

### Verification

- Clean source commit: `8e34bac2530f43f84819c22fc4ac45fb3b1db7ee`.
- Root clean install, full and production-only npm audits: `0 vulnerabilities`.
- DSH clean install and `npm audit --prefix dsh-plugin --audit-level=moderate`:
  `0 vulnerabilities`.
- DSH build and client loader contract: pass.
- The package evidence above predates this dependency-only change and must be
  replaced by a new NSIS build from the exact clean source.

### Exact next step

Finish the clean-source Rust/full gate, rebuild the NSIS candidate from commit
`8e34bac2530f43f84819c22fc4ac45fb3b1db7ee`, rerun artifact/install evidence,
then update the current package hashes in the release evidence documents.

## Clean-source package after nested DSH audit closure

### Verification

- Source commit: `8e34bac2530f43f84819c22fc4ac45fb3b1db7ee`.
- Full local gate: Vitest `151` files (`1,023` passed, `1` skipped), TypeScript,
  Web, extension, DSH and Rust `--all-targets` (`41` tests), root and nested
  DSH audits, docs/version/red-team/secret checks, and critical stability
  `10/10` all pass.
- NSIS: `Flovart_0.3.2_x64-setup.exe`, `12,248,570` bytes, SHA-256
  `2639193E7A59CD081056DF13D8214F1F455B351BA3A3B950623260CC91A4D29A`.
- SPDX-2.3 SBOM: 663 packages and 1,377 relationships; artifact checker has
  zero errors.
- Isolated installer smoke: install `0`, real executable launch observed,
  graceful close, uninstall `0`, install root removed.

### Current external gates

The package is unsigned local evidence (`Authenticode: NotSigned`). Hosted
CI/CodeQL/provenance, production updater signing, public release publication,
real Provider billing/quality, and logged-in Codex certification remain
external. The exact package and machine result are in
`C:\tmp\flovart-rc-artifacts-clean-candidate-20260902-v8`.

### Exact next step

Review or publish this candidate through the repository's Hosted workflow on
the exact source SHA. Do not call the production launch GO until Hosted
security/provenance, production signing, and required real account/provider
certification evidence is attached.

## Final-source browser recheck

- Clean source `8e34bac2530f43f84819c22fc4ac45fb3b1db7ee` was rerun in visible
  Chromium with a fresh browser context and local Fake Provider HTTP server.
- The first-run path opened `/#/app`, remained Canvas-editable before setup,
  connected with service address + API Key, discovered three models, showed one
  product-language cost confirmation, and rendered the fake image artifact.
- The recorder observed one image-generation POST with prompt `一只猫` and zero
  references; API Key presence was false, page errors were `0`, and console
  errors were `0`.
- Refreshed evidence: `C:\tmp\flovart-c14-first-user-evidence.json`,
  `C:\tmp\flovart-c14-first-run.png`, and
  `C:\tmp\flovart-c14-first-generation.png`.

## Final exact candidate and repository gate snapshot

### Current phase

Final Release Candidate Certification: exact-source evidence reconciliation.
The current candidate is clean and detached at
`8e34bac2530f43f84819c22fc4ac45fb3b1db7ee`; it has not been pushed, tagged,
or published.

### Verification

- Full local quality gate: Vitest `151` files (`1,023` passed, `1` skipped),
  TypeScript, Web, extension, DSH and Rust `--all-targets` (`41` tests) passed.
- Root full/production-only npm audits and nested DSH moderate audit: `0`
  vulnerabilities.
- Docs contract (`134` files), version parity (`0.3.2`, owner
  `avabbbb/Flovart`), release red-team, secret audit (`919` files / `0`
  findings), critical suite (`10/10`), and diff check passed.
- Current local NSIS: `Flovart_0.3.2_x64-setup.exe`, `12,248,570` bytes,
  SHA-256
  `2639193E7A59CD081056DF13D8214F1F455B351BA3A3B950623260CC91A4D29A`.
  Artifact/SBOM verification and isolated install, launch, graceful close and
  uninstall passed. Authenticode is `NotSigned` by design for this local RC.

### Read-only GitHub snapshot

- Remote `main` is `969478db26e7f55668bcb3a782e58962fe0f3f47`; it contains only
  the scheduled traffic snapshot after the older reviewed SHA.
- Public Releases still contain only immutable `v0.2.0-test`.
- No Hosted run is associated with the exact candidate. The latest relevant
  remote runs are still on older main: Security succeeded, CI failed, and
  Build Desktop ended in `startup_failure`.
- Public CodeQL has 13 open alerts on older main (1 critical, 9 high, 3
  medium); the candidate has no Hosted scan yet.
- Repository API reports Dependabot security updates and Secret Scanning/push
  protection disabled, no rulesets, Actions allowed for all actions, and main
  unprotected. No repository setting was changed.

### RC0 residual-process cleanup

The final process audit found one stale `node agent/index.js` from the earlier
temporary candidate worktree, owning `127.0.0.1:17373`. Its command line did
not point at the user worktree. Only that PID (`46624`) was force-stopped; no
user Chrome/Edge process was touched. A follow-up listener/process check found
no Flovart candidate, Playwright, Fake Provider, Vite, or certification
processes and no listener on the tested RC ports.

### Exact next step

Owner-approved publication of this exact candidate is required before running
Hosted CI/CodeQL/release dry-run on the same SHA. After Hosted results are
attached, update `RC_CODEQL_TRIAGE.md`,
`GITHUB_REPOSITORY_SECURITY_CHECKLIST.md`, and `RELEASE_TRUTH_MATRIX.md` with
run IDs. Production launch remains `NO-GO` until production signing, real
Provider certification, and the prepared Codex login transcript are attached.

## Final RC package recheck after CLI help closure

### Current phase

Final Release Candidate Certification: exact application/package evidence
reconciliation. The current application/package source is clean detached
commit `a1e6a39d232558fddd29c286bcbbb389218ac437`; it has not been pushed,
tagged, or published.

### Changes and decisions

- Retired provider setup/model-test/batch commands are now labelled `[retired]`
  in conventional CLI help, while the stable five-command Agent surface and
  compatibility registry remain unchanged.
- The DSH plugin direct `esbuild` range is now `^0.28.2`; the clean nested DSH
  moderate-severity audit reports zero vulnerabilities. CI and security
  workflows run that nested audit explicitly.
- No Workflow, Provider, Browser authority, Host projection or secret-boundary
  architecture was changed in this recheck.

### Verification

- Full Vitest: `151` files passed; `1,024` passed and `1` skipped (`1,025`
  total), exit `0`.
- Focused provider-routing regression: `6/6`.
- TypeScript, Web build (`4,306` modules), Browser Extension build, DSH build
  and client-loader contract, and Rust `--all-targets` (`41` tests): passed.
- Root full/production-only npm audits and nested DSH moderate audit: `0`
  vulnerabilities.
- Docs contract (`134` files), version check (`0.3.2`, `avabbbb/Flovart`),
  release red-team, secret audit (`919` files / `0` findings), critical suite
  (`10/10`) and `git diff --check`: passed.
- Current unsigned local NSIS package:
  `Flovart_0.3.2_x64-setup.exe`, `12,248,622` bytes, SHA-256
  `0A7B6B79CFD6EAC2A031ADB2838846895F7A31CBFCDC4182515E33F8526F7CE6`.
  `release:artifacts:check` passed with zero errors and the SPDX-2.3
  package-lock SBOM contains 663 packages and 1,377 relationships.
- Repeated isolated installer smoke returned `installExit: 0`,
  `launchObserved: true`, `closeMode: graceful`, `uninstallExit: 0`, and
  `installRootExistsAfterUninstall: false`.
- The visible fresh-context Browser/Fake Provider first-user smoke remains
  green: Canvas was editable before setup, a service address plus API Key
  discovered models, one product-language cost confirmation preceded one
  T2I request, and the artifact appeared with zero page/console errors.

### Exact local artifact

The package is staged at
`C:\tmp\flovart-rc-artifacts-clean-candidate-20260902-v9` and is bound to the
application/package source commit above. Authenticode is `NotSigned` by design
for this local RC. The package does not certify production updater signing,
Hosted provenance, real Provider billing, or a logged-in Codex transcript.

### Remaining external gates

- Owner-approved publication and one Hosted CI/security/CodeQL/desktop dry run
  on this exact source are still required.
- Repository security settings (Dependabot, secret scanning/push protection,
  branch/ruleset protection and Actions policy) remain owner gates.
- Production Tauri signing/Authenticode, real Provider certification and real
  Codex certification remain pending. DSH remains Experimental unless its
  authenticated lifecycle is separately certified.

### Exact next step

Publish or otherwise authorize this exact application/package source for a
Hosted dry run, attach the resulting run IDs and attestations, and keep the
production launch verdict `NO-GO` until the external gates are complete.

## Exact v10 packaged UI observation boundary

The current v10 NSIS package was installed into disposable roots and launched
with test-only WebView2 debugging policies on ports `48129` and `48130`; a
fixed-port process observation on `48131` confirmed the real app and its
isolated WebView2 child. The real app logged normal Runtime startup, but no
debug listener or `/json/version` endpoint became available in the bounded
probes; consequently no UI assertion or Provider request was made from that
installed window. The result is `NOT_VERIFIED` for exact-package UI generation,
not a product failure or a substitute for source WebUI evidence. All probe
processes and RC ports were cleared. The exact temporary install and profile
paths remain as trace artifacts because the shell safety policy rejected
recursive deletion; they contain no repository or user project data.

## Final candidate package rebuild

The final application/package source anchor is clean detached commit
`e7b8280014478e4fd3021f4f9a578b343bea11d2`. From that source,
`npm run tauri:build` completed the Vite production build, Rust release build,
and NSIS bundle. The resulting `Flovart_0.3.2_x64-setup.exe` is
`12,242,510` bytes with SHA-256
`36DE61FACC47A5293BE31EF521E0A4A2CCD75E1C22D023AB327C2CBBD5091155`.
The staged checksum/SBOM artifact checker passed with zero errors, and the
isolated installer smoke passed install, real executable launch, graceful
close, uninstall, and install-root removal. Evidence refreshes after this
package build are documentation-only and do not change the packaged
application source.

## Final candidate quality rerun

After the v10 package was rebuilt from application/package source commit
`e7b8280014478e4fd3021f4f9a578b343bea11d2`, the final source was rechecked
without changing application code. Full Vitest passed `151` files with `1,024`
passed and `1` skipped; TypeScript, extension build, DSH build/loader contract,
and Rust `cargo test --all-targets` (`41` tests) passed. The critical suite was
green `10/10`, root and nested DSH audits reported zero vulnerabilities, and
version/docs/red-team/secret/artifact gates remained green. This is local
candidate evidence only; Hosted CI/CodeQL/provenance, production signing,
real Provider and real Codex certification remain external.

## Test-only installed UI first-generation evidence

The exact v10 no-debug package still has a separate `NOT_VERIFIED` WebView2 UI
observation boundary. To close that observability gap without changing
production code or configuration, a second NSIS package was built from the
same application source anchor `e7b8280014478e4fd3021f4f9a578b343bea11d2`
with an external test-only Tauri window overlay at
`C:\tmp\tauri-webview-cdp-test.conf.json`. The overlay exposed CDP on port
`48134` only for this disposable test package.

Installed packaged UI smoke passed: Home → 新建 Workflow → first-run setup →
editable unconfigured Canvas → image prompt → local Fake Provider model
discovery → one product-language cost confirmation → one generated image on
the Canvas. The recorder observed one `POST /v1/images/generations` for
`gpt-image-2`, prompt `一只猫`, zero references; page/console errors were zero
and the fake key was absent from browser/recorder evidence. Test package hash,
install path, screenshots and machine-readable evidence are recorded in
`RC_PACKAGED_UI_EVIDENCE.md`.

This strengthens the installed product-path evidence only. The test package is
not the production v10 artifact, is unsigned, and does not change the pending
Hosted, production signing, real Provider or real Codex gates.

## Final autonomous local certification checkpoint

The clean candidate evidence commit is
`4a060ec380a096a8f63effbc169291d6fb3d7c00`; the application/package source
anchor remains `e7b8280014478e4fd3021f4f9a578b343bea11d2`. The candidate has
not been pushed, tagged, or published. The exact v10 production-configured
local NSIS artifact remains `Flovart_0.3.2_x64-setup.exe`, `12,242,510` bytes,
SHA-256 `36DE61FACC47A5293BE31EF521E0A4A2CCD75E1C22D023AB327C2CBBD5091155`,
and `release:artifacts:check` passes with zero errors.

The final local recheck passed: Vitest `151` files / `1,024` passed / `1`
skipped; TypeScript; Web build (`4,306` modules); extension build; DSH build
and client-loader contract; Rust all-targets (`41` tests); critical suite
`10/10`; official-registry root full and production-only audits; nested DSH
moderate audit; docs contract `135` files; version parity; release red-team;
secret audit `920` files / `0` findings; artifact verification; and diff
hygiene. The candidate has no tested RC listener or process remaining.

The source-identical test-only WebView2 overlay package completed the installed
Home → 新建 Workflow → first-run AI setup → editable Canvas → Fake Provider
model discovery → cost confirmation → T2I artifact path with zero page/console
errors and no fake-key leakage. This does not upgrade the exact v10 no-debug UI
observation, production signing, Hosted provenance, real Provider or Codex
status.

```text
PRODUCT CORE: PASS (local evidence)
AUTONOMOUS RC: PASS (local scope)
RELEASE CANDIDATE ENGINEERING: PENDING HOSTED CERTIFICATION
PRODUCTION LAUNCH: NO-GO
```

Remaining external gates are owner-authorized publication of the candidate,
Hosted CI/security/CodeQL/release dry-run and attestation, repository security
settings, production Tauri/Authenticode signing, real Provider certification,
and the logged-in Codex certification transcript. DSH remains Experimental
unless its authenticated lifecycle is separately certified. The exact next
step is to publish or otherwise authorize this candidate for Hosted execution,
attach run IDs and artifact attestations, and retain `NO-GO` until the external
gates pass.

## CLI package distribution closure

An isolated `flovart-cli@0.3.2` install found one real release defect after the
Desktop candidate checkpoint: the npm `files` allowlist omitted
`crew-command-surface.js`, so the installed `flovart --help` crashed before
the CLI could start. The allowlist was corrected to include that module plus
the reachable `bootstrap-coordinator.js` and `web-discovery.js` modules.

The repaired tarball was built and installed in a disposable prefix. It
contains 69 package entries, includes the `bin`, `managed-agent` and Skill
projections, and passed `flovart --help` (exit 0) and `flovart status --json`
(exit 0, structured offline status). The tarball is
`flovart-cli-0.3.2.tgz`, 123,585 bytes, SHA-256
`EA3A4EC80FBCFC19F0EDCADBC029949BB68E2283F81FF6519B034A1C1FF0E1C1`.
`tests/cliPackageManifest.test.js` now guards the package allowlist against
missing reachable top-level modules. This fix is currently uncommitted in
the main user worktree; the Desktop NSIS evidence above remains bound to its
separate clean application source anchor and is not relabeled as containing
this npm-only change.
## Exact clean candidate after CLI distribution closure

The final local clean candidate is d22406102260715e8a3c229b1eb84e48a913ef81.
It includes the corrected flovart-cli@0.3.2 package allowlist and
tests/cliPackageManifest.test.js. From this candidate, the Windows x64 NSIS
artifact Flovart_0.3.2_x64-setup.exe is 12,250,236 bytes with SHA-256
2E4BED3B09F5A11D62062C2C020ACEE25245E20E30EB5BFB1391C4DA003DA1B0.
Artifact/SBOM verification and isolated install, launch, graceful close and
uninstall passed. The candidate is unpushed and unsigned; Hosted CI/CodeQL,
repository security settings, production signing, real Provider and logged-in
Codex certification remain external, so production launch stays NO-GO.
The matching flovart-cli@0.3.2 tarball is 123,596 bytes with SHA-256
F9EB5E2823D6A9B4ED27C0D19276C6AB561A93DF5C7C9FAE168C98D307A701FB and passed
isolated npm installation, help and structured offline status.
## Exact candidate final recheck

The exact candidate recheck passed full Vitest (152 files; 1,026 passed, 1
skipped), TypeScript, Web/extension/DSH builds, DSH loader contract, Rust
all-targets (41 tests), critical stability 10/10, official-registry audits,
docs (136 files), version, red-team, secret (921 files / 0 findings) and diff
hygiene. The only local release warning is the intentional unsigned status.

## Final exact candidate after warning cleanup

The exact clean detached candidate is
`d539a9979cb7230f95783e3144d21ea9b6ac7685`; it is clean and unpushed. A fresh
`npm run tauri:build` produced the Windows x64 NSIS package
`Flovart_0.3.2_x64-setup.exe`, 12,252,502 bytes, SHA-256
`97B144CEBA32864DE2905F6588EA1F6827AAD83AE1F76C8126A07E25B7ADED53`.
Artifact/SBOM validation and isolated install, real executable launch,
graceful close and uninstall passed from
`C:\tmp\flovart-rc-artifacts-clean-candidate-20260902-v11`.

The same candidate passed full Vitest (152 files; 1,026 passed; 1 skipped),
TypeScript, Web/extension/DSH builds, DSH loader contract, Rust all-targets
(41 tests), critical stability 10/10, official-registry dependency audits,
docs (136 files), version, red-team, secret (921 files / 0 findings), artifact
and diff checks. The matching `flovart-cli@0.3.2` tarball is 123,596 bytes,
SHA-256 `F9EB5E2823D6A9B4ED27C0D19276C6AB561A93DF5C7C9FAE168C98D307A701FB`;
isolated npm install, `flovart --help` and structured offline status passed.

The candidate is unsigned and has no Hosted CI/CodeQL/provenance run attached.
Production signing, repository security settings, real Provider certification,
authenticated Codex certification and public release publication remain
external gates. Existing non-fatal jsdom/React `act(...)` and Ant Design
deprecation warnings remain visible in the full test output; no assertion
failed, and the previous unawaited usage-monitor warning is fixed.

## Stable-tag signing preflight

The desktop release workflow now fails closed before the Tauri action when a
stable `v*` tag has no `TAURI_SIGNING_PRIVATE_KEY`. Manual/local dry-runs keep
using `src-tauri/tauri.local.conf.json` with updater artifacts disabled. The
release red-team checks the workflow marker and the YAML parser successfully
parsed all six tracked workflow files. This is a workflow hardening change in
the current main worktree; Hosted execution still remains external.

## External release state rechecked

Read-only GitHub checks on 2026-09-02 still show the candidate is not on the
remote `main`: the latest public release is `v0.2.0-test`, and the latest CI,
Desktop and Security runs are attached to the older `main` SHA
`9a1534b035350152c87d93a5f6e07f7452f3f66f1`. The public API still reports 13
open CodeQL alerts on that older SHA. Dependabot alerts/security updates,
secret scanning/push protection are disabled; `main` is unprotected, rulesets
are empty, and Actions allow all actions with SHA pinning disabled. No GitHub
setting, push, tag or release was changed by this pass. These remain external
release gates for the final candidate.

The latest read-only `codex login status` is `Not logged in`. The main user
worktree contains two ignored signing-key files, which were not read or used;
the clean candidate contains none. This does not convert either local file
presence or the absent Codex session into production certification.

## Final exact candidate with stable-tag signing preflight

The final clean candidate is commit `71f8395e071e237d6fb83c03e340d55d795b3df0`
in `C:\\tmp\\flovart-rc-clean-8e34bac-20260902`. It contains the release
workflow fail-closed check requiring `TAURI_SIGNING_PRIVATE_KEY` for stable
`v*` tags and the corresponding red-team assertion. The candidate is clean;
the main worktree remains dirty by design so existing user changes are
preserved.

The exact candidate passed the local release gates: full Vitest `152 files,
1026 passed, 1 skipped`; critical suite `10/10`; TypeScript; web, extension,
DSH and Rust builds/tests; version parity; docs contract across `136` files;
secret audit `921 scanned, 0 findings`; release red-team with no failures;
YAML parsing for all six workflows; artifact verification; and `git diff
--check`. The final NSIS artifact was rebuilt from this candidate as
`Flovart_0.3.2_x64-setup.exe`, `12,250,318` bytes, SHA-256
`A731DA53DFCE2A27F8F09BE0E57222B5E6E375BA6DFE7069088AB76B3F289DF8`, and the
isolated install/launch/close/uninstall smoke passed. Its file version and
product version are `0.3.2`; it is intentionally unsigned in the local
dry-run. The isolated CLI package smoke also passed (`flovart-cli@0.3.2`,
SHA-256 `F9EB5E2823D6A9B4ED27C0D19276C6AB561A93DF5C7C9FAE168C98D307A701FB`).

The exact formal NSIS package has no usable WebView2 CDP endpoint, so packaged
UI generation remains explicitly `NOT_VERIFIED`; the source-identical CDP
overlay test remains separate evidence and passed the first-run, Fake Provider
T2I path. No production updater signature/latest feed was produced. Hosted
GitHub workflow execution, repository security settings, production signing,
real Provider certification, and real Codex login remain external gates.

Next step: preserve this evidence and obtain the external approvals/credentials
before any production tag or publication. Do not push, tag, publish, alter
GitHub settings, or read the ignored local signing-key files without explicit
authorization.

## Final release-truth sweep

The current evidence-document heads were reconciled to the exact candidate
`71f8395e071e237d6fb83c03e340d55d795b3df0`, the v12 NSIS artifact, and the
latest local counts. Historical v10/e7b references remain only in explicitly
historical sections. The final local checks were rerun after this sweep:
docs contract `136` files, version parity `0.3.2`, red-team no failures,
secret audit `921` files / `0` findings, candidate artifact checker `ok`, and
`git diff --check` passed.

The read-only remote snapshot now observes `origin/main` at
`c60b452719fc3b0ddd32225556fbd86b73b5f299` (`chore: daily traffic snapshot`);
the candidate is still not published or rebased onto that generated commit.
The public release remains `v0.2.0-test`. GitHub Code Scanning still reports
13 open alerts whose observed instances point to `9a1534b035350152c87d93a5f6e07f7452f3f66f1`; repository security settings still report
Dependabot updates, Secret Scanning/push protection disabled, no branch
protection/rulesets, and no Hosted run for the candidate. These are read-only
external gates; no GitHub setting or remote state was changed.

## Final RC candidate after updater artifact verification

The clean temporary candidate was advanced to
`e98564a8fe20aa97c8cfcab05749db06035843c9` in
`C:\tmp\flovart-rc-clean-8e34bac-20260902`. The temporary candidate worktree
is clean and contains only the release-metadata verifier/test/workflow change
after the prior `71f8395e` source boundary; the main worktree remains dirty by
design so user changes are preserved.

The exact candidate was rebuilt with `src-tauri/tauri.local.conf.json` into
`C:\tmp\flovart-rc-artifacts-clean-candidate-20260902-v13`:

```text
Flovart_0.3.2_x64-setup.exe
bytes: 12249053
sha256: 9eb92267aca04f672adad4c50b0c8fd39ff1a9666bb5d9a4f8317290d3448af1
```

The NSIS artifact checker, real install/launch/graceful-close/uninstall smoke,
full Vitest (`153` files, `1030` passed, `1` skipped), TypeScript, Web,
extension, DSH, Rust, critical `10/10`, docs (`136` files), version, secret
(`923` scanned, `0` findings), red-team and `git diff --check` gates passed.
The focused updater verifier passed `4/4` tests and the isolated test-signed
feed passed its valid `latest.json` + `.sig` sidecar check.

The desktop release workflow now stages Tauri's `latest.json` and target
signature sidecars on stable tags and fails closed when a platform entry,
versioned HTTPS artifact, or matching `.sig` is absent. This verifier checks
feed/sidecar metadata integrity; it does not claim cryptographic production
signature verification. Local builds intentionally disable updater artifacts,
so production signing, Hosted CI, provenance, public feed publication, real
Provider billing and authenticated Codex remain external gates.

Next step is evidence-only final local gate rerun and report reconciliation.
Do not push, tag, publish, alter GitHub settings, or read the ignored local
signing-key files without explicit authorization.

## Final candidate after public-doc parity closure

The previous `e98564a` candidate was extended with the public documentation
parity fix that makes compatibility `command.schema` lookup diagnostic-only;
the resulting clean candidate is
`4e06c7fb57a668347189de23d731fa912104e080` in the same temporary worktree.
The exact candidate was rebuilt into
`C:\tmp\flovart-rc-artifacts-clean-candidate-20260902-v14`:

```text
Flovart_0.3.2_x64-setup.exe
bytes: 12248495
sha256: 9156349dab4f217ba0108df32dfff22c54ca262c139d8e55de4f81a92976cffe
```

The v14 artifact passed checksum/SBOM validation and the real isolated NSIS
install, launch, graceful-close and uninstall smoke. The exact candidate then
passed full Vitest (`153` files, `1030` passed, `1` skipped), TypeScript,
extension build, DSH build/loader contract, Rust `41` tests, critical `10/10`,
docs (`136` files), version parity, secret audit (`923` scanned, `0` findings),
release red-team, updater focused tests (`4/4`) and `git diff --check`.

The candidate is still detached, clean, unpushed and untagged. The main
worktree remains dirty by design and still contains two ignored local signing
files; these were not read or used. No Hosted workflow, production signature,
public updater feed, real Provider account or authenticated Codex result is
claimed. Production launch remains `NO-GO` until those external gates are
certified.

## Final candidate after matrix-level updater verification

The release workflow was then hardened against a multi-platform feed race:
`latest.json` accumulates entries as matrix jobs upload their assets, so the
per-platform jobs only stage local evidence and the `publish-release` job now
downloads the complete draft asset set after `build` succeeds. It rejects an
absent draft, unsafe asset name, missing feed, or failed `latest.json`/`.sig`
verification before the draft can become public.

The resulting clean candidate is
`5ed7da08f083b314f75159f99c7e1929e9a3b3bd`. Its exact v15 local NSIS package
is staged at
`C:\tmp\flovart-rc-artifacts-clean-candidate-20260902-v15`:

```text
Flovart_0.3.2_x64-setup.exe
bytes: 12249203
sha256: d87730624188a82cb1425beef0a723c9564898cfbb59c817d3bc2bbfcbd55247
```

The package checker and real isolated install/launch/graceful-close/uninstall
smoke passed. The candidate's full Vitest, TypeScript, extension, DSH, Rust,
critical `10/10`, docs/version/secret/red-team and diff gates were already
green before this workflow-only change; the workflow change itself passed
red-team and updater focused tests. No Hosted run, production signature,
public feed, real Provider, or authenticated Codex certification is claimed.

## Final exact candidate after release-finalizer invariant

The current clean candidate is
`3f9bee9306f44da3ea8be9c480ad4e5fc91acf65`. Its v16 local NSIS artifact is
staged at `C:\tmp\flovart-rc-artifacts-clean-candidate-20260902-v16`:

```text
Flovart_0.3.2_x64-setup.exe
bytes: 12250417
sha256: ec89aa5cf9fea82b824ba229bd9368d6f5aa49e4f2b1f32adf040c1854d25020
```

The release red-team now asserts that the complete updater feed check is in
`publish-release`, after draft assets are downloaded, rather than in one
partial matrix job. The exact candidate passed full Vitest again (`153` files,
`1030` passed, `1` skipped), and the v16 checksum/SBOM plus isolated NSIS
install/launch/graceful-close/uninstall smoke passed. The candidate remains
detached, clean, unpushed and untagged; Hosted workflow, production signing,
real Provider and authenticated Codex certification remain external.

## Hosted environment probe after final local candidate

Two non-release GitHub Actions workflows were manually dispatched against the
remote `main` SHA `c60b452719fc3b0ddd32225556fbd86b73b5f299`; neither run used
the unpublished local candidate. CI run [33598287044](https://github.com/avabbbb/Flovart/actions/runs/33598287044)
failed only at the older remote Docs contract because it still required the
missing/stale generated `tools/flovart/skill/SKILL.md` and the retired Agent
surface; its separate Critical suite 10x job passed. Security run
[33598299717](https://github.com/avabbbb/Flovart/actions/runs/33598299717)
passed tracked-secret audit and both CodeQL jobs; dependency review was
skipped because manual dispatch is not a pull request.

The exact local candidate was then checked from a new detached checkout with
no generated Skill and no copied dependencies: `npm ci --ignore-scripts` plus
`npm run docs:check` passed (`135 files`). This confirms the local checker fix
does not depend on ignored packaging output. Hosted certification of the exact
candidate remains pending because it has not been published.

## Browser launcher and port isolation follow-up

The latest concrete runtime issue was repeated Windows-default-browser pages
opening at `127.0.0.1:37522` without a Browser binding. The cause is that a
plain WebUI origin is not sufficient for a fresh Agent session; it needs the
one-time bootstrap handoff. The source start path now keeps `37522` and
`17373` as preferences only, supports `--web-port=0 --agent-port=0` for an
isolated run, and automatically chooses free loopback ports when the
preferred WebUI port is occupied. `web.open` also adds the bootstrap internally
when a ready local Agent is available while returning only the sanitized WebUI
origin.

Evidence from the isolated Chrome for Testing smoke on 2026-09-02:

```text
plain origin: clients=0, hasWorkflow=false
bootstrap origin: clients=1, hasWorkflow=true
browser: C:\Users\ava\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe
dynamic WebUI/Agent examples: 5204 / 13772
preferred-port fallback: 37522 occupied -> WebUI 12326, unrelated blocker preserved
console errors: 0
```

The test used temporary Agent config/discovery paths and cleaned its exact
processes afterward. The user's `C:\Users\ava\.flovart\agent.json` origin
was restored to `http://tauri.localhost`; no token was printed or persisted in
the test evidence. Focused startup/docs/Skill tests are green (`5` files,
`34` tests); the full suite is green after this final launcher change.

## Current working-tree release regression after launcher guidance cleanup

The current worktree remains intentionally dirty and is not being presented as
the published candidate. After removing the remaining guidance that could
start only a plain, unbound WebUI, the local release gates were rerun:

```text
version: 0.3.2 / avabbbb/Flovart — pass
docs contract: 136 files — pass
release red-team: pass, failures=[]
secret audit: 925 files, 0 findings — pass
focused Skill/startup suite: 2 files, 19 tests — pass
full Vitest: 154 files, 1035 passed, 1 skipped — pass
TypeScript: pass
Web build: 4306 modules — pass (existing chunk/import warnings only)
Browser extension build: pass
DSH build and client-loader contract: pass
Rust all-target tests: 41 — pass
critical suite: 10/10 — pass
```

The no-Edge browser regression was rerun through the Playwright skill using
Chrome for Testing at
`C:\Users\ava\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe`.
With isolated random ports it observed a plain origin with
`clients=0 / hasWorkflow=false`, then the one-time bootstrap origin with
`clients=1 / hasWorkflow=true`, page title `Flovart`, connected status visible,
and zero console/page errors. A separate run occupied preferred port `37522`
and verified automatic fallback to an available port while preserving the
unrelated process and opening no browser window. The exact test processes were
cleaned and no listener remained on `37522` or `17373`.

The next step remains release evidence reconciliation and owner-approved
Hosted execution; no push, tag, release, GitHub setting change, Edge launch,
or production signing-key read occurred.

## External gate snapshot rechecked

Read-only GitHub checks still show `origin/main` at
`c60b452719fc3b0ddd32225556fbd86b73b5f299`, with no `v0.3.2` tag and only the
public `v0.2.0-test` release. The latest CI run
`33598287044` is for that older remote SHA and failed its stale public-doc
contract; the separate critical job passed. Security run `33598299717` passed
its tracked-secret and CodeQL jobs, but the exact local candidate has no Hosted
run. The repository API still reports Secret Scanning/Push Protection disabled,
`main` unprotected, and 13 open CodeQL alerts on the remote snapshot.

`codex login status` remains `Not logged in`. These are unchanged external
gates, not local test failures; no remote state was modified.

## Local RC specialization recheck

The post-cleanup focused RC suites also passed on the current worktree:

```text
Canvas/migration: 2 files, 9 tests
Provider/Fake HTTP: 3 files, 21 tests
Offline/security/diagnostics: 4 files, 6 tests
Resource/plugin contracts: 2 files, 7 tests
Agent session/bootstrap: 4 files, 29 tests
root npm audit: 0 vulnerabilities
dsh-plugin npm audit: 0 vulnerabilities
```

These are local evidence only. The exact clean release candidate still needs
to be rebuilt from a clean commit after the final launcher-guidance change;
the remote candidate run, production signing, real Provider billing and
authenticated Codex remain external.

## Skill runtime-version parity follow-up

The three source Skill projections and generated packaged projection were
aligned from the stale Node.js `20.10` wording to the actual package minimum
Node.js `22.19.0`. `scripts/check-docs-contract.mjs` now derives that minimum
from the root package engine and rejects projection drift. The updated docs
contract, release red-team, and focused docs/Skill suite (`2` files, `13`
tests) pass.

## Clean candidate reproducibility and Chrome-only release recheck

The visible current worktree was snapshotted into the disposable detached
worktree `C:\tmp\flovart-rc-current-clean-20260902` and committed as
`66276e58227d71fc37772ce280fbc518b253794d`. The main worktree remains dirty
by design; no reset, push, tag, release, or remote setting change was made.
The clean candidate installed root and DSH dependencies with `npm ci
--ignore-scripts` and remained clean after packaging/build outputs.

The first all-in-parallel attempt produced two resource-pressure failures:
two Vitest files reached their 5-second timeout while Rust was compiling, and
Cargo hit Windows `os error 1455` while mmap-ing rlibs. This was not accepted
as a pass or ignored as a flaky test. The two failed Vitest files passed alone,
the full serial Vitest rerun passed, and a fresh `cargo clean` followed by
`CARGO_BUILD_JOBS=1 cargo test --manifest-path src-tauri/Cargo.toml
--all-targets -j 1` passed all 41 Rust tests.

Current clean-candidate gates:

```text
version: 0.3.2 / avabbbb/Flovart — pass
docs: 136 files — pass (after npm pack projection)
release red-team: pass, generated Skill aligned
secret audit: 925 files / 0 findings — pass
root and DSH npm audit: 0 vulnerabilities — pass
Vitest: 154 files, 1035 passed, 1 skipped — pass
TypeScript: pass
Web build: 4306 modules — pass
Browser extension build: pass
DSH build and client-loader contract: pass
Rust all-target tests: 41 — pass (clean single-job rebuild)
critical suite: 10/10, 50 tests per repetition — pass
git diff --check: pass
```

The exact clean candidate also produced a local unsigned Windows x64 NSIS
package:

```text
Flovart_0.3.2_x64-setup.exe
bytes: 12246365
sha256: EC3BF0EEA4CBB6891E085A47660DBB1FE90B3206EFE4ECDE1DC9D66E8C778412
```

Checksum plus local SPDX-2.3 package-lock SBOM verification passed (663
packages, 1377 relationships). The exact package passed silent install,
real executable launch, graceful close, silent uninstall, and install-root
removal. It is local unsigned evidence only; production updater signing,
Authenticode, Hosted provenance, real Provider, and authenticated Codex
remain external gates.

The browser smoke was rerun against this clean candidate with the Playwright
skill and Chrome for Testing, never Edge. It used dynamic WebUI/Agent ports
`1157/2008`: the plain origin reported `clients=0 / hasWorkflow=false`, the
one-time bootstrap origin reported `clients=1 / hasWorkflow=true`, the page
showed `Flovart` and connected status, and console/page errors were zero. The
preferred-port collision smoke also preserved the unrelated listener and
selected a free WebUI port. Exact test processes and listeners were cleaned
afterward; no listener remained on `37522` or `17373`.

## Latest exact candidate after public Quick Start route closure

The first-user Chrome smoke initially failed on a stale test assertion that
expected the old literal `http://localhost:37522/#/app` documentation string.
The product path was not failing: the current launcher already chooses a
dynamic loopback port. The public Chinese and English Quick Start documents
were updated to state the canonical `#/app` Workflow route without teaching a
fixed port, and the smoke assertion was changed to validate the route contract
and `start --source --web --open` command instead.

The visible worktree was then snapshotted into the clean detached candidate
`C:\tmp\flovart-rc-current-clean-20260902-v2` and committed as
`111db63d4261cd81cf7f5cadd340f1044cea32e8`. The candidate remained clean and
unpushed/untagged. A new exact NSIS build from this SHA completed with
`npm run tauri:build` using `src-tauri/tauri.local.conf.json`:

```text
Flovart_0.3.2_x64-setup.exe
bytes: 12248572
sha256: 0E8753064D4C9150C67D632396E158EC614945AACE663F47167688C2DB8A1C3F
```

The staged artifact directory is
`C:\tmp\flovart-rc-artifacts-current-20260902-v2`. The checksum/SPDX checker
passed with zero errors; the SBOM is SPDX-2.3 with 663 packages and 1,377
relationships. The isolated NSIS smoke returned install exit `0`, observed the
real `flovart.exe`, graceful close, uninstall exit `0`, and no remaining
temporary install root.

The exact candidate recheck passed:

```text
Vitest: 154 files, 1035 passed, 1 skipped
TypeScript: pass
Web build: pass, 4306 modules transformed
Browser extension: pass
DSH build/client-loader contract: pass
Rust all-target tests: 41 passed after cargo clean, -j 1, RUSTFLAGS=-C debuginfo=0
Critical suite: 10/10, 50 tests per repetition
Version/docs/red-team/secret checks: pass (docs 136 files; secret 925/0)
root and dsh-plugin npm audit: 0 vulnerabilities
git diff --check: pass
```

The real visible first-user smoke ran with Chrome for Testing at
`C:\Users\ava\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe`,
not Edge, using isolated ports `18757` (WebUI) and `18758` (Fake Provider).
It completed fresh `/#/app` launch, editable unconfigured Canvas, image-node
prompt entry, Base URL/API Key connection, model discovery, product-language
cost confirmation, and one displayed fake image. The recorder observed one
`POST /v1/images/generations`, zero page/console errors, and no API key in the
browser or recorder. Evidence is
`C:\tmp\flovart-c14-first-user-evidence.json`; exact test listeners were
cleaned afterward.

The remaining release state is unchanged: no Hosted run is attached to this
detached SHA; production signing, hosted provenance/security settings, real
Provider billing/quality, and authenticated Codex certification remain
external gates. No Edge window was used for this validation and no listener
remained on `37522` or `17373`.

## Chrome-only launcher recheck from current worktree

After the user reported repeated unreachable Edge windows and collisions on
`127.0.0.1:37522`, the browser acceptance method was rerun from the current
worktree through the Playwright skill. Dev-server detection found no existing
server. The harness used Chrome for Testing at
`C:\Users\ava\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe`,
never the Windows default browser, and started Flovart with
`--no-open --web-port=0 --agent-port=0`.

The run assigned WebUI port `10588` and Agent port `10613`. The plain
`/#/app` origin remained deliberately unbound (`clients=0`,
`hasWorkflow=false`); the one-time bootstrap URL then established the
Browser Writer (`clients=1`, `hasWorkflow=true`). The page title was `Flovart`,
the connected indicator was visible, and console/page errors were zero.
The browser and exact launcher-owned process trees were cleaned afterward;
ports `37522`, `17373`, `10588` and `10613` had no listeners, and no Edge
process was created by this run. Full details are in
`RC_BROWSER_LAUNCH_EVIDENCE.md`.

This closes the test-method issue, not the external release gates. Normal
user-facing `--open` still follows the OS default browser; automated tests are
now explicitly Chrome-only and dynamic-port-only.

## Chrome memory/performance probe

The same isolated Chrome-for-Testing method was used for a 30-cycle real page
reload probe with `--web-port=0 --no-open --no-browser-agent`. The dynamic
WebUI port was `3795`; no Edge process or fixed `37522`/`17373` listener was
used. After an explicit page GC when available, the active page heap settled
near `40 MiB` from cycle 6 through cycle 30, with a temporary `47.2 MiB` peak
and `38.3 MiB` final value. No application-level linear page-heap growth or
page/console error was observed. The full Chrome process tree warmed from
`530.1 MiB` to a `741.0 MiB` peak and ended at `723.6 MiB`, so that figure is
kept as a browser/workstation baseline rather than misclassified as a Flovart
retained-object leak. Full measurements are in `RC_PERFORMANCE_EVIDENCE.md`.

## Browser bind/unbind soak closure

The Chrome-only harness then completed 50 isolated Browser bind/unbind cycles
with dynamic WebUI `10031` and Agent `4287` ports. All 50 bootstrap bindings
reached `clients > 0 / hasWorkflow=true`, all 50 context closes returned the
Agent to `clients=0`, page-title failures were zero, and console-error cycles
were zero. Bind median was `1,122 ms`, steady-state p95 `1,408 ms`; cycles 1
and 2 were explicitly retained as cold-start outliers at `23,287 ms` and
`15,317 ms`. The final health state was disconnected with no pending client,
and all test processes/listeners were cleaned. This closes the local R30
Browser bind/unbind requirement while preserving the cold-start observation.

## Source launcher soak closure

To cover the launcher side of R30 without opening any system browser, a
separate loop started and stopped the source WebUI 50 times with
`--web-port=0 --no-browser-agent --no-open --json`. Every cycle passed a real
`data-flovart-webui="1"` HTTP check, used a unique dynamic port, and cleaned
its process tree. Startup time was median `2,685 ms`, p95 `2,899 ms`, worst
`3,120 ms`; failures were `0`. This is source WebUI/launcher evidence, not a
claim about Tauri installed-app cold start. No Edge window was created.

## Repeated installer lifecycle closure

The staged local NSIS package also passed 10 isolated install/uninstall cycles.
Each cycle used a unique validated temporary root, returned installer and
uninstaller exit `0`, and removed the root; median elapsed time was `3,383 ms`,
p95 `3,421 ms`, worst `3,637 ms`. The installed app was not launched during
this repetition, so it adds installer mechanics evidence without touching the
user's app-data profile. The existing full install/launch/uninstall and
test-signed updater evidence remain separate.

## Desktop launch baseline closure

The latest staged NSIS package was launched 20 times by a PowerShell harness
with `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `FLOVART_RUNTIME_DISCOVERY`,
`FLOVART_AGENT_CONFIG` and `WEBVIEW2_USER_DATA_FOLDER` directed to validated
temporary paths. Ten independent profiles represented cold starts and ten
same-profile relaunches represented warm starts. All 20 reached a visible
main window and closed gracefully. Cold median/p95/worst was
`117/123/126 ms`; warm was `113/121/128 ms`. The measurement boundary is main
window readiness, not Canvas ready or Web Vitals; no browser was opened and no
Edge process was involved.

## Current-worktree Vitest regression closure

One current-worktree full-suite run briefly exposed `fetch failed: bad port` in
`tests/fakeProviderServer.test.js`. The test then passed in isolation, in
`30/30` repeated jsdom/Vitest process runs, and in `100/100` repeated
jsdom/Vitest process runs. A direct Node HTTP loop also passed `100/100`; the
temporary failure diagnostic was removed afterward. The next full current
worktree run passed with `154` files, `1,035` passed tests and `1` skipped test
(`1,036` total, exit `0`). No application code was changed for this
observation, and it is not counted as a hidden retry-based pass.

The current working-tree documentation contract also passed with `138` files;
the exact detached application/package candidate remains the earlier
`111db63d4261cd81cf7f5cadd340f1044cea32e8` source anchor with its separately
recorded `136`-document candidate check. The local RC remains unpushed,
unsigned, and without real Provider/Codex credentials.

The final current-worktree critical repeat then passed `10/10` (9 files and 50
tests per repetition). TypeScript, the Web build (`4,306` modules), Browser
extension build, DSH build/client-loader contract, root and nested DSH audits,
and the staged NSIS/updater artifact verifiers also passed. No application
source changed during this final regression closure.

## Current v3 clean candidate and exact NSIS evidence

The final local clean candidate was snapshotted at
`712031d88a427fb04316e590f74cffef67f435b9`, after the current release and
evidence files were reconciled. Fresh root and DSH `npm ci --ignore-scripts`
completed with zero vulnerabilities. The candidate passed the full Vitest
suite (`154` files; `1,035` passed and `1` skipped), the critical suite `10/10`,
TypeScript, Web (`4,306` modules), extension, DSH and Rust all-target tests
(`41` Rust tests), version/docs/red-team/secret checks and `git diff --check`.
The candidate docs contract counted `137` documents; the current working tree
recheck counted `138` after evidence-only additions.

The exact v3 NSIS package is
`Flovart_0.3.2_x64-setup.exe`, `12,247,434` bytes, SHA-256
`67FE186BD5AA6221190BE3AA98EC5C5639C1935AC685D28E8FB8489426439E1D`, staged
at `C:\tmp\flovart-rc-artifacts-current-20260902-v3`. It has an SPDX-2.3
SBOM with `663` packages and `1,377` relationships. Artifact validation and
isolated install/real launch/graceful close/uninstall passed. The local Tauri
overlay intentionally omits updater `latest.json`, so its updater checker is
not a pass; the separately recorded test-signed N→N+1 feed remains the local
update-chain evidence, while production signing and Hosted execution remain
external.

## RC0 residual browser-process cleanup

The final baseline audit found five stale Playwright runner trees from the
previous automated acceptance pass. Each root was explicitly identified by
the command line `run.js ... playwright-test-today-task.js` and its child
Chrome used a dedicated `playwright_chromiumdev_profile-*` directory. Only
those five verified test trees were terminated; user Chrome, OMP Chrome and
system Edge were not targeted. The post-cleanup check reports:

```text
test Chrome processes: 0
test runner processes: 0
Flovart-related Edge processes: 0
listeners on 37522/17373: 0
```

## Browser launch correction and Docker port isolation

The user-visible failure was traced to two separate paths. Automated acceptance
was previously allowed to call the Windows default URL handler, which opened
Edge and could leave a plain, unbound WebUI tab. The Docker `--open` path also
used the source preference `37522` even though Compose publishes the Web
container on `1635`; that URL was genuinely wrong for Docker mode.

The current working tree now provides `npm run test:browser:chrome`. It starts
the source launcher with `--no-open --web-port=0 --agent-port=0`, uses
Playwright's Chrome for Testing executable and an isolated persistent profile,
builds the one-time bootstrap URL in the test harness, and terminates only its
own process tree. The latest run passed with Chrome for Testing
`chromium-1223`, WebUI `http://127.0.0.1:10482`, Agent
`http://127.0.0.1:3842`, `clients=1`, `hasWorkflow=true`, a scrubbed final URL,
and zero console/page errors. After cleanup, no listener remained on
`37522`, `17373`, `1635`, `10482` or `3842`, and no Flovart-related Edge process
remained.

Docker Compose now accepts `FLOVART_DB_PORT`, `FLOVART_HUB_PORT`,
`FLOVART_ENTERPRISE_PORT` and `FLOVART_WEB_PORT`. `flovart start --source
--docker --open` selects an available host port for every selected service,
waits for the actual WebUI URL, and only then opens it. `docker compose config`
passed with both default and overridden host ports; the focused dev-command
suite passed `19/19`, including the rendered Docker browser URL, overlapping
service-port allocation, and Web dependency-closure allocation.

## RC environment alignment recheck

The root `package.json` and CLI require Node `>=22.19.0`; the Dockerfile had
been the remaining Node 20 exception. It now uses `node:22-alpine`, and the
release identity check plus default/overridden Compose configuration still
pass. Docker image build itself was not run because Docker is unavailable in
this Windows environment.

After that change, `npm run test:browser:chrome` passed again with Chrome for
Testing `chromium-1223`, dynamic WebUI `3594`, dynamic Agent `4099`,
`clients=1`, `hasWorkflow=true`, clean final URL, and zero console/page errors.
No fixed listener remained on `37522`, `17373` or `1635`, and no Edge process
was created.

The post-fix full local gate completed with `154` Vitest files, `1,039`
passing tests and `1` skipped test; TypeScript, Web, extension, DSH and Rust
checks remained green. The new port-closure and Docker-plan regressions are
included in that count.

The final current-worktree recheck completed with `154` Vitest files, `1,040`
passing tests and `1` skipped test; the focused dev-command suite is `20/20`.
The latest Chrome for Testing smoke used WebUI `11290` and Agent `11291`,
reported `clients=1 / hasWorkflow=true`, zero console/page errors, and left no
listener on the preferred or dynamic test ports.

## Current clean candidate certification snapshot

The current working tree was isolated into clean candidate
`7bf531cf3e1fe02ccf68f38e38c5b97dc04f0306`; the main worktree remains
untouched and dirty as before. Fresh root and DSH installs passed. Candidate
checks passed: full Vitest `154 files / 1040 passed / 1 skipped`, clean
TypeScript, Web, extension and DSH builds, critical `10/10` (`9` files and
`50` tests per repetition), docs/version/red-team/secret/dependency checks,
and Chrome for Testing smoke (`clients=1`, `hasWorkflow=true`, zero page and
console errors). A concurrent clean Chrome run timed out under simultaneous
full test/build CPU load; the isolated rerun passed, so it is recorded as an
execution-environment contention observation rather than hidden.

The same candidate built a real unsigned Windows x64 NSIS package:
`Flovart_0.3.2_x64-setup.exe`, `12,247,854` bytes,
SHA-256 `A36EE61CF7CBA75948D1B8D6278E1814E40113B9962AE7A91684C2F0F86C5ACF`.
The SPDX-2.3 SBOM contains `663` packages and `1,377` relationships; artifact
validation and install/launch/graceful-close/uninstall passed. Clean candidate
Rust compilation completed through Tauri packaging, and the standalone clean
Rust test gate passed after the package build. No production signing or
external account was used.
