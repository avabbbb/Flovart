# Production Skill、Flovart Agent 与 AI 原生画布设计

## 当前结论

当前存在两条没有闭环的链路：Workspace Agent 能直接改浏览器画布，Production Runtime 能持久化运行并把阶段与 Artifact 投影回画布，但两者还没有共享一个可编辑 Workflow Draft。当前实现不能宣称已经是 AI 原生画布：

| 表面 | 当前状态 | 是否同步可见画布 |
| --- | --- | --- |
| `generate.video` Production Runtime | 已真实生成、持久 Task/Event/Artifact | 仅通过运行投影显示结果，不保留完整编辑过程 |
| 正式 CLI/MCP 的 16 条 Workspace 命令 | 经 Managed Agent 调用页面内 `workflowDispatcher` | 是，要求 `workspace.status=ready` |
| CLI shadow runtime | Workflow 命令已停止使用该路径 | 否，不再作为节点回退 |
| Vite file queue | 可以入队，WebUI 没有消费端 | 否，可能返回误导性 pending |
| WebUI Workflow Agent | 读取当前项目快照并执行创建、更新、移动、连接、选择和运行命令 | 是，但只写浏览器项目，未进入获批 ProductionSpec |
| `workflow.projection.get` | 从 Runtime 恢复阶段、状态与 Artifact | 是，但当前是运行态投影，不是可继续编辑的制作过程 |

新的目标边界是：执行批准前以 Workflow Draft 为编辑权威，设计师与 Flovart Agent 通过同一套 Workflow Draft Action 直接操作可撤销画布；批准后才冻结为 ProductionSpec Revision，并由 Runtime 负责 ProductionRun。Production Plan Projection 继续同步运行状态与 Artifact，但不得把后端结果列表冒充成完整可编辑工作流，也不得覆盖尚未批准的草稿。

## 深模块与职责

### Production Skill Compiler

小 Interface：

```text
preview(draft, boundSkill, context) -> ProductionPlanPreview
compileApproved(draft, boundSkill) -> ProductionSpec
review(spec, artifacts) -> ReviewResult
```

它把当前 Workflow Draft 与可选 Bound Production Skill 编译为可预览、可批准的制作计划，隐藏风格知识、叙事方法、镜头拆解和质量规则，但不执行 Provider 请求、不接触 Secret、不维护任务状态。

### Production Control

面向 Flovart Skill、CLI、MCP 和 WebUI 的唯一制作 Interface：

```text
production.session.create
production.spec.create-revision
production.dry-run
production.approve
production.run
production.status / production.watch
production.retry-stage
production.replan
task.cancel
artifact.get / artifact.list
```

Runtime 在内部展开 ProductionRun、StageRun、ProviderAttempt、Artifact、预算和 Gate；调用者不需要学习 Provider payload、轮询协议或 SQLite 表。

### Workflow Draft 与 Production Projection

Workflow Workspace 同时承载两种明确分离的状态：编辑中的 Workflow Draft，以及获批后由 Runtime 派生的 Production Plan Projection。前者是设计师与 AI 的共同创作面，后者是运行状态视图；两者不能继续被叫作同一个“投影”。

```text
Workflow Draft：读取 / 应用可撤销动作 / 预览执行计划 / 批准冻结
workflow.projection.get
workflow.layout.update
production.spec.create-revision
```

- Workflow Draft 中的提示词、连线、参考素材、模型参数、布局与画布内二次处理步骤先直接成为可见、可撤销的草稿动作，不为每次键入或拖拽创建 ProductionSpec Revision。
- `production.spec.create-revision` 只在用户批准当前草稿，或批准从运行中 Revision 派生的新草稿时创建不可变版本。
- `workflow.projection.get` 读取指定 Revision/Run 的 StageRun、Artifact、费用和审批状态；它不能回写并覆盖当前草稿。
- `workflow.layout.update` 继续负责已批准运行视图的纯布局变化；Workflow Draft 自身的布局随草稿保存。

如果缺少统一的草稿动作与批准编译边界，AI、UI、CLI、Runtime 和 Production Skill 会重新各自持有一套制作状态，因此 Workflow Draft 必须成为深模块。草稿动作、历史和持久化边界已经统一为 Draft Action、Draft ChangeSet 与一项目一 Workflow Draft Authority。

### Draft ChangeSet

- 一个 Flovart Agent 回合形成一个 Draft ChangeSet；人工连续输入、拖动或调参按明确的手势结束、失焦或短时合并边界归组。
- ChangeSet 记录操作者、意图、类型化 Draft Action、受影响对象、前后差异和执行结果，并可关联对应 Provider Task 与 Artifact。
- 撤销与重做以 ChangeSet 为设计师可理解的基本单位；完整快照只作为恢复检查点，不替代语义历史。
- 不永久记录每个按键和指针移动，也不只保存若干无法解释“谁为什么改了什么”的整图快照。
- Agent 回合开始时创建 `open` ChangeSet，动作验证通过后逐步耐久提交并流式显示；结束状态为 `completed`、`partial`、`failed` 或 `undone`，页面关闭后仍可恢复中断现场。
- 单步失败不回滚同回合已成功操作，也不隐藏已经计费或产生 Artifact 的事实。失败 Operation Node 保存 Recipe、错误类别、ProviderAttempt/费用状态和修改后重试入口。
- 按组撤销会从当前 Draft 应用逆向动作，但 ProviderAttempt、Usage Ledger 与 Artifact 作为历史事实继续保留；没有被图引用的媒体再按正常垃圾回收策略处理。

Draft Change Timeline 是 ChangeSet 的设计师视图，不是 Runtime 调试日志：

- 每项显示操作者、意图、completed/partial/failed/undone 状态、受影响对象数、差异摘要、费用与 Artifact 关联；
- 点击时间线项会缩放并高亮受影响节点/连线，点击节点的“来源修改”会反向定位对应 ChangeSet；
- 时间线提供按组撤销、重做、查看差异和失败步骤重试，不展示每个键盘/指针事件；
- Agent 聊天工具卡只保存 `changeSetId` 链接与人话解释，聊天删除或分支变化不影响 Draft 历史；
- 面板默认轻量收起，不长期占用画布，但 partial、failed 和待确认记录必须有可见状态入口。

### Workflow Operation Node

所有产生新媒体结果的 Workflow 动作使用同一图形态：

```text
输入媒体节点 --input-role--> Workflow Operation Node --result--> 输出媒体节点
```

- Operation Node 保存 `operationKind`、Prompt/Rich Prompt、规范化参数、Product Model + Generation Mode、输入角色、输出槽位和关联 Task/Artifact；具体 Provider Route 仍由执行时 Route Mapping 解析。
- 图片生成、局部编辑、扩图、放大、裁剪、旋转、拆层、视频剪辑、音视频分离、拼接、抽帧与音频处理都通过同一节点契约表达，不再有的覆盖源节点、有的生成孤立结果、有的只补一条无语义连线。
- 重跑 Operation Node 创建新的 Take/Artifact 并保留旧输出；修改 Prompt 或参数只修改 Workflow Draft，重新批准后才影响已授权制作。
- Operation Node 使用语义 LOD：运行中、失败、待确认、最近修改、选中或固定的操作显示完整卡片；稳定完成的简单步骤才可随缩放折叠成连线 chip，至少显示操作名、状态、Take 数和警告。
- chip 与完整节点都必须可直接命中、键盘聚焦并打开同一 Prompt/参数/Take 面板；用户可以固定单节点展开或一键全局展开。错误和待确认状态不能因缩放隐藏，折叠状态属于视图，不能删除操作配方和来源关系。
- Workflow 只承载单步、局部、立即服务下一次生成的操作；批量、多步骤、多输入/多输出、时间轴精修和可复用处理链进入独立 Table Processing Graph。
- 两个工作区共享 `MediaOperationRecipe` Schema、参数控件和执行器，但不共享节点实例、历史或布局；不能因复用组件而混图或双写。

### Operation Prompt Document

- 结果型 Operation Node 拥有唯一 `promptDocument`；输出媒体节点只保存 `sourceOperationNodeId` / Take / Artifact 引用，不复制 Prompt。
- `promptDocument` 保存用户可见文本、Rich Prompt 结构，以及每个 `@` 引用的稳定对象 ID、角色、顺序和可读别名；不能只把最终拼接字符串当权威。
- 现有 PromptBar 绑定当前选中的 Operation Node，是设计师与 Agent 共享的数据编辑视图；不新增 InlinePromptBar、NodePrompt 或聊天专属 Prompt 副本。
- Agent 的 Prompt 修改是带对象版本前置条件的 Draft Action，进入当前 ChangeSet，并更新 Recipe Hash；输出媒体或旧 Take 的历史 Prompt 不被原地改写。
- Text 节点可以作为 Operation 的显式输入或引用来源，但不替代 Operation 对最终创作 Prompt 的所有权。

### Operation Input Binding

`OperationInputBinding` 是 Prompt 引用与图连接的唯一数据：

```text
id
sourceNodeId | sourceArtifactId
targetOperationNodeId
role
ordinal
promptAnchor?
objectVersion
```

- 在 PromptBar 通过 `@` 选择素材会创建 Binding 和画布输入边；内联位置或参考条 chip 只保存 `bindingId`。
- 从画布拖入 Operation 的边会按 Media Operation Recipe 选择/推断输入角色，并在 PromptBar 生成同一 Binding 的 chip；角色不明确时必须让用户或 Agent补齐，不能靠连线顺序猜测。
- 删除边或 chip、改变角色、拖拽排序都作为同一 Binding 的 Draft Action 同步两个视图，并受对象版本检查。
- Recipe Schema 负责角色、媒体类型、数量和顺序约束；Route Preflight 在执行前基于 Binding 校验。
- 现有 `mentionedNodeIds`、`referenceNodeIds`、`imageReferenceOrder` 和无角色 connection 需要迁移为 Binding，不再作为四个可独立写入的真相源。

### Operation Capability Registry

现有 `nodeToolCatalog`、`WorkflowNodeToolbar` handlers、Agent system prompt 工具列表、Dispatcher 校验和执行 `switch` 不是五个权威。它们收敛到一个轻量、无 React/Provider 重依赖的版本化 Registry：

```text
id + version
labelKey + iconKey + controlRendererKey
workspaceEligibility: workflow-inline | table-only | both
inputRoles[] + outputRoles[]
recipeSchema + parameterSchema
executorKind: local | provider-capability | runtime
runtimeCapability?
sideEffectClass: draft-only | local-artifact | provider-paid | publish | irreversible
confirmationClass
resultPolicy
```

- Agent tool schema、工具栏动作、参数控件、Draft Action 校验、Route Preflight、费用/确认判断和 Contract Test 从 Registry 派生。
- 注册表只引用 executor/control key，具体实现由对应深模块绑定，避免基础契约导入重型 UI 或 Provider 代码。
- 未注册 `operationId@version` 不能进入 Workflow Draft 或 Table Graph，已存在节点执行时必须解析到精确兼容版本。
- V1 由 Flovart 平台发布 Operation Capability；Production Skill 只能组合已注册能力并补充风格上下文，不能注册任意 HTTP、Shell、脚本或私有执行阶段。
- 首轮迁移要删除当前 UI 有而 Agent 目录没有、或 Agent 可调用但没有一致参数控件的漂移列表。

### Workflow Agent Tool Loop

内置 Flovart Agent 复用 PI Agent Core 的状态化工具循环，不再让 `workflowOnlineAgent` 先输出最多 8 条 JSON 命令再盲目顺序执行：

1. 用户回合创建一个 open Draft ChangeSet。
2. Agent 通过 Draft Authority Port 读取当前对象与版本，只获取完成当前判断所需子图。
3. Agent 调用 Registry 派生的类型化 Draft/Operation 工具；工具执行 Schema、权限、对象版本与副作用级别校验。
4. 返回新 Draft/Object Version、受影响对象、差异、任务句柄或结构化错误，画布与 Timeline 同步显示。
5. Agent 根据真实结果继续、重读冲突子图、暂停请求精确子图授权，或结束并关闭 ChangeSet。

循环设置最大工具步数、总时长、上下文预算与用户取消；支持 steer/follow-up，但不能绕过 Production Mandate。付费 Operation 可以先被创建为 pending，用户批准方案卡后 Runtime 提交任务；工具返回持久 Task/Run 句柄，Agent 不轮询 Provider。普通状态由 Workspace 展示，只有授权、对象冲突、审片、语义失败或额外输入恢复 Agent。

网站内旧 Workflow Agent、内置 Flovart Agent、CLI/MCP 不得保留三套不同动作语义：第一切片以后主产品只通过 Flovart Agent + Draft Authority Port + Registry 操作；外部 Agent 继续使用相同契约的操作 Skill/MCP Adapter。

### Execution Prompt Snapshot

运行前由 Prompt Compiler 从 Operation Prompt Document、输入绑定、模型能力和规范化参数生成不可变 Snapshot：

```text
promptDocumentHash
renderedText
referenceBindings[]
normalizedParameters
compilerVersion
```

- Prompt 增强、翻译、模板和 Provider 适配必须展示相对可编辑文档的差异，不能静默回写 PromptBar。
- 每个 ProviderAttempt 与 Operation Take 引用准确 Snapshot；Snapshot 不包含 API Key、Authorization Header 或未脱敏 Provider HTTP Body。
- 设计师选择“采用到 PromptBar”时，以新的 Draft Action 更新 Operation Prompt Document、Recipe Hash 和受影响授权；历史 Snapshot 保持不可变。
- 相同可编辑 Prompt 经过不同模型/编译器可能产生不同 Snapshot，因此不能用当前节点文本事后冒充某个旧 Take 的实际输入。

当前工具的默认分层原则：

| Workflow 单步操作候选 | Table 复杂处理候选 |
| --- | --- |
| 生成、局部编辑、扩图、放大、简单裁剪/旋转、简单视频或音频截取、首尾帧导出 | 批量处理、图层/宫格拆分、分镜拼接、音视频分离、多片段合并、逐帧视频、精细抠图/遮罩、深度/边缘/法线与可复用处理链 |

具体工具可以根据输入输出数量和交互深度调整归属，但同一种项目内操作只能有一个数据权威。

### Workflow Layout Intent

Agent 的节点创建/重组动作只声明语义布局：

```text
relativeToNodeId
direction: after | before | above | below | parallel | branch
groupId?
orderHint?
```

Canvas Adapter 内的确定性 Layout Planner 根据真实节点尺寸、Operation 展开/折叠状态、当前视口与占用区域计算最终坐标，并把坐标作为同一 ChangeSet 中的派生 Draft Action 保存。设计师手工拖动后节点进入 pinned 状态；Agent 永不移动 pinned 节点，也不在每个回合重排全图。只有用户明确“整理选择区域”时，才可重排被选中且未固定的既有节点。

布局动作可独立撤销，不更新 Operation Recipe Hash、Execution Prompt Snapshot、Authorized Operation Subgraph 或 ProductionSpec Revision。

### 提升到 Table

当单步 Workflow Operation 需要批量、多步骤或精修时，用户或 Flovart Agent 执行显式 Table Promotion：

1. 固定源 Workflow Operation、输入 Artifact、当前 Media Operation Recipe 和 Draft 版本。
2. 创建新的 Table Session 与 Table Processing Graph，把输入和配方作为起点，而不是共享原节点实例。
3. Workflow Operation 转为 Table 引用步骤，保存 `tableSessionId`、源 `operationNodeId`、当前 `publishedArtifactId` 与发布版本摘要；参数编辑入口改为“在 Table 中打开”。
4. Table 独立产生候选输出和历史；试验、撤销与分支不回写 Workflow。
5. 用户或 Agent 明确执行“发布到 Workflow”后，Workflow Draft 以一个新的 Draft ChangeSet 更新所引用的 Artifact；旧发布版本继续保留并可回退。

禁止两边实时双写同一配方，也禁止提升后复制成两个没有来源关系的独立步骤。

### Workflow Draft Authority

- 纯 Web 项目绑定 Browser Workspace，继续使用 localforage 保存完整 Workflow Draft。
- Desktop 或已配对 Official WebUI 的项目绑定 Local Data Service；UI、Agent、CLI 都通过同一 Draft Action 接口操作，页面关闭不影响草稿可用性。
- 同一项目任一时刻只允许一个 Authority。浏览器与 Runtime 禁止双写，也不以“最后写入者获胜”做静默合并。
- 从 Browser Workspace 切换到 Local Data Service，或反向切换，必须显式导出、校验、导入并更新 Authority Binding；失败时保留原权威不变。
- Production Plan Projection 仍由 Runtime 派生，但它是获批运行视图，不是第二个 Workflow Draft Authority。

所有调用方只依赖 `WorkflowDraftAuthorityPort`：

```text
draft.get / subscribe
changeset.open / appendActions / close / undo / redo
operation.take.append / select
authority.export / validate / import / bind
```

首个图片 tracer bullet 先实现 Browser Workspace/localforage Adapter，并把现有 Zustand 收敛为 UI projection/cache，不再让 Agent、Toolbar、Dispatcher 和历史各自直写 store。Desktop Local Data Service Adapter 后续实现同一契约；在显式 transfer 完成前不得同时启用两个写 Adapter，也不得用 Runtime Projection 反向覆盖 Browser Draft。Browser 页面关闭后 Agent 无法继续编辑的限制保持可见，不伪装成 Desktop 耐久能力。

### 草稿动作授权

可撤销的 Workflow Draft Action 默认直接执行并流式显示，不逐条弹确认：创建、更新、连线、移动、缩放、布局和可撤销删除都属于这一类。每个动作必须显示执行主体和结果，并进入所属 Draft ChangeSet，设计师可以随时接手修改或按组撤销。

以下边界继续要求显式确认：

- 提交可能计费的 Provider 生成、批量重跑或扩大预算；
- 冻结 Workflow Draft、创建 ProductionSpec Revision 与 Production Mandate；
- 发布、覆盖外部目标或其他不能通过草稿历史恢复的动作；
- Runtime 或权限策略判定为 System Gate 的动作。

确认策略可以作为用户偏好调整，但“可逆草稿编辑”和“付费/授权/不可恢复执行”必须是两类不同能力，不能继续用一个笼统的 `mutation` 开关处理。

### 精确子图授权

AI 可以在不产生费用时搭建、连线和修改完整 Workflow Draft，本地确定性且可撤销的操作也可以立即运行。需要 Provider 的 Operation Node 不逐个弹窗，也不继承会话级开放预算；Production Plan Card 一次展示并锁定：

```text
draftVersion
operationNodeIds + dependencyClosure
recipeHashes
specRevisionId
routePlan
runBudget
reviewPolicy + gates
```

“确认并开始”创建只覆盖该精确 Authorized Operation Subgraph 的 Production Mandate。新增节点默认未授权；修改 Operation 的 Prompt、参数、输入角色或模型意图时，只让该节点与受影响下游的授权失效，其他已提交 StageRun 继续按原 Mandate 执行。布局、折叠和选择变化不影响授权。

Provider 执行失败时，Operation Node 进入可见 error/needs-attention 状态并保留已解析 Route、Attempt、费用状态与错误；机械重试创建新 Attempt，修改 Recipe 后重试则进入新的 Draft ChangeSet，并按受影响子图重新授权。

Provider 返回结果时必须比较 Attempt 的 `recipeHash` 与 Operation 当前 Recipe Hash：

- 相同：追加 Operation Take，并按运行计划决定是否自动设为当前选择；
- 不同：追加标记为 `outdated-recipe` 的 Take，保留 Artifact、Attempt 与费用事实，但不更新 `selectedTakeId`、当前输出边或下游 ready 状态；
- 用户比较后“采用此 Take”：以新的 Draft ChangeSet 更新选择，并按受影响下游重新预览/授权；
- 不允许因结果过时而删除、隐藏或假称未计费。

Take 详情必须同时展示可编辑 Prompt 的来源版本和实际 Execution Prompt Snapshot，并提供差异查看与“采用到 PromptBar”，避免设计师误把增强后的 Provider 文本当成原始意图。

## 画布同步协议

批准前，AI 与人工动作必须先应用到同一 Workflow Draft，并立即在画布与对话工具记录中可见。批准后，Runtime 每次提交权威运行状态时追加脱敏事件：

```json
{
  "eventType": "workflow.projection.updated",
  "productionRunId": "run_...",
  "data": {
    "projectId": "project_...",
    "specRevisionId": "spec_...",
    "projectionVersion": 12,
    "changedNodeIds": ["shot_2", "take_2b"]
  }
}
```

WebUI 通过与 CLI 相同的 Production Runtime Event Stream 订阅已批准 Run 的事件；收到版本跳跃时重新读取 `workflow.projection.get`。该流只更新运行投影，不替代 Workflow Draft 的动作同步，也不依赖 Agent 推送一份无法合并的完整浏览器快照。

节点至少保存这些引用：

```text
productionSessionId
specRevisionId
productionRunId
stageRunId
shotId
selectedArtifactId
projectionVersion
```

进度显示来自 StageRun/ProviderAttempt Event，不由 UI 猜测。Provider 只返回阶段状态时显示“排队/提交/生成/下载/验证”，只有 Provider 提供可靠百分比时才显示百分比。

## 用户如何细修

| 用户操作 | 权威写入 | 后果 |
| --- | --- | --- |
| 批准前拖动节点、缩放画布 | Workflow Draft | 可撤销，不创建 ProductionSpec Revision |
| 批准前通过 PromptBar/Agent 修改 Operation Prompt Document、时长、运动、旁白、字幕 | Workflow Draft | 修改同一权威文档，画布立即可见并可继续细修 |
| 批准前添加/替换参考图 | Workflow Draft + Artifact 引用 | 连线与参考关系保留在草稿中 |
| 批准当前草稿 | 新 ProductionSpec Revision | 冻结执行输入并生成新的 Production Plan Projection |
| 运行中修改制作语义 | 从当前 Revision 派生新 Workflow Draft | 原 Run 与旧 Artifact 保留，重新批准后才影响后续执行 |
| 在 Operation Node 的多个结果中选 Take | Workflow Draft 中的 Artifact 选择 | 保留旧 Take，不覆盖文件；重新批准后进入新 Revision |
| 重新生成单镜头 | `production.retry-stage` 或 Revision 后新 Stage | 创建新 ProviderAttempt/Artifact |
| 调整 VO 或字幕时间 | 新 Workflow Draft，批准后新 Revision | 只重跑 speech/render/verify |
| 仅裁剪、抠图、局部媒体处理 | 进入 Table Artifact 工具链 | 不把处理步骤伪装成 Workflow 生成语义 |

Agent 与用户同时编辑时采用对象级乐观并发。每个 Draft Action 携带 `baseDraftVersion`，修改既有节点或连线时还携带 `expectedObjectVersions`；服务端或当前 Draft Authority 以原子比较后提交。过期动作返回 `PRECONDITION_FAILED`、冲突对象 ID、当前对象版本与最小差异，不能最后写入者覆盖。

Agent 收到冲突后只重新读取受影响子图：如果用户修改与原意兼容，生成最小新动作；如果意图冲突，失败 Operation Node 保留现场并请求用户选择。互不相关节点继续执行，同一 Agent ChangeSet 可以因此标为 `partial`，但不锁定整个画布。`parentRevisionId` 只用于从已批准 Revision 派生新草稿，不作为草稿内并发控制字段。

## Flovart Agent 制作循环

Flovart Agent 只编排以下稳定循环：

1. 发现 Runtime 与 Canonical Registry。
2. 按用户确认加载零或一个 Bound Production Skill Snapshot。
3. Flovart Agent 与设计师在 Workflow Workspace 共同形成可见、可撤销的 Workflow Draft。
4. Production Skill Compiler 从当前草稿与待执行 Operation 子图生成执行预览，显示能力缺口、路线报价、预算和 Gate。
5. 用户一次批准精确子图后冻结 ProductionSpec Revision、创建 Production Mandate 并启动 ProductionRun。
6. Runtime 自己运行；Flovart Agent 只响应状态投影与 Intervention Event，不持续轮询。
7. 只有审片、语义失败、预算或额外输入触发 Agent Intervention。
8. 用户细修先进入新 Workflow Draft，重新批准后形成新 Revision；机械失败只重试最小失败 Stage。
9. 以 Delivery Artifact、验证报告、费用与来源关系交付。

Flovart Agent 不应该列出几十个 Provider 特化命令；其能力来自用少量 Production Intent 隐藏任务恢复、成本、ProviderAttempt 和画布同步。外部 Agent 使用的操作 Skill 只说明如何调用这些稳定接口，不成为第二个制作总控。

## Production Skill Creator

Creator 必须是独立 Authoring Skill，不并入 Flovart Agent 的运行时制作循环。推荐流程：

```text
create/import
  → scaffold
  → static validate
  → zero-cost dry-run
  → eval
  → pack
  → publish
```

标准包：

```text
production-skill/
├── SKILL.md
├── flovart.skill.yaml
├── agents/openai.yaml
├── schemas/extension.schema.json
├── references/style.md
├── evals/cases.yaml
└── assets/                 # 仅在确实需要可复用资源时
```

不要创建 README、安装指南或 Changelog。`SKILL.md` 保持精炼，把风格词典、镜头规则和长示例放入 `references/`。

### Manifest 最小形状

```yaml
schemaVersion: flovart.production-skill/1
id: community.vox-director
version: 1.0.0
productionSpec:
  coreVersion: "1"
  extensionSchema: schemas/extension.schema.json
runtime:
  minVersion: 0.4.0
capabilities:
  - image.generate
  - video.generate.image-to-video
  - speech.generate
  - media.render
  - media.verify
permissions:
  network: none
  secrets: none
  filesystem: package-readonly
gates:
  - id: approve-storyboard
    type: storyboard
  - id: approve-style
    type: style-bakeoff
evals:
  entry: evals/cases.yaml
license: MIT
```

禁止字段：

- API Key、Credential ID 或 Secret 环境变量；
- Provider endpoint、私有 Route ID 或硬编码模型请求；
- 任意 Shell/HTTP 执行；
- 自定义任务轮询和自动重提；
- 绕开平台预算、System Gate 或 Artifact Store 的私有 Stage。

### 导入 `vox-director`

保留：

- beat map、叙事弧与镜头节奏；
- style bake-off；
- 纸张拼贴风格、构图、字体与动画原则；
- VO、音乐、字幕与质量 Gate；
- image-first、image-to-video 的一致性方法。

迁移：

- Atlas Cloud 调用 → Provider-neutral Capability Requirement；
- 环境变量 Key → Desktop Keyring；
- 模型 ID → Validated Profile；
- ffmpeg 命令 → `media.render` Runtime Capability；
- 下载/轮询/重试 → Production Runtime；
- 风格专属字段 → `extensions.community.vox-director`。

## 分阶段放行

### S1：诚实能力面

- 已完成：Public MCP 只暴露 Canonical Registry 中 `available` 的命令。
- 已完成：Flovart Skill 区分 Runtime Artifact 与 visible Workspace 节点。
- 已完成：CLI/MCP 共用 Runtime/Workspace command surface，Workspace 写命令要求幂等键且不回退 shadow/file queue。

### S2：运行态只读投影（当前实现基线）

- 实现 `artifact.get/list`、`workflow.projection.get`。
- `generate.video` 成功后在画布出现只读 Shot/Take/Artifact 节点；这只是运行恢复能力，不是目标交互。
- WebUI 关闭后重开仍从 Runtime 恢复同一投影。

### S3：AI 原生 Workflow Draft

- 首个 tracer bullet 固定为 `image.generate → image.crop → image.upscale`，不同时迁移全部图片、视频和音频工具。
- AI 与设计师通过同一画布动作面创建、连接、修改、运行和撤销节点；Prompt、参考、模型参数及二次处理步骤均可见、可保存、可继续编辑。
- 所有结果型操作形成输入媒体 → Operation Node → 输出媒体；操作配方可折叠但可展开编辑，重跑产生新 Take 而不覆盖源媒体。
- PromptBar 与 Agent 修改同一 Operation Prompt Document；稳定 `@` 引用、角色和顺序可恢复，输出媒体与聊天不持有漂移副本。
- PromptBar `@` chip 与画布输入边是同一 Operation Input Binding 的双视图；添加、删改、角色与排序不会漂移。
- AI、工具栏、Dispatcher 与 Preflight 从同一 Operation Capability Registry 得到操作与参数契约，未注册能力不可执行。
- 每个 Take 可查看实际 Execution Prompt Snapshot 及其与源 Prompt Document 的增强/翻译/适配差异，并可显式采用回 PromptBar。
- Operation Node 按状态和缩放自适应展开；运行、错误、待确认与当前编辑步骤始终完整可见，稳定简单步骤才折叠，且支持全局展开。
- Agent 只表达相对布局意图，由前端确定性布局器找空位；人工固定节点不被移动，纯布局可撤销且不影响制作授权。
- 一个 Agent 回合或连续人工手势形成语义 Draft ChangeSet，可查看差异、关联任务与产物并按组撤销。
- Agent 多步操作部分失败时，成功步骤与产物留在画布，失败 Operation Node 保留参数、错误和重试入口；不会整回合回滚或只在聊天中报错。
- Agent 在每个工具结果后观察最新 Draft 再继续，不先生成盲目命令批次；长时任务由 Runtime 观察，授权/冲突/介入事件才恢复循环。
- 画布与 Draft Change Timeline 双向定位：从 Agent 回合查看差异并聚焦节点，也能从节点追溯是谁、为何、通过什么动作产生。
- 设计师可在 Agent 执行时编辑其他节点；同对象冲突拒绝旧 Agent 动作并只重算相关子图，不锁画布、不静默覆盖人工修改。
- Operation 运行中被修改后，旧 Recipe 晚到结果显示为可比较的旧版本 Take，不自动替换当前输出或启动下游。
- 纯 Web 与 Desktop 项目复用同一 Draft Action/ChangeSet 契约，并完成单一 Draft Authority 的显式转移与冲突拒绝。
- Workflow Operation 可以显式提升为 Table Session；提升后 Table 独占配方，只有明确发布的 Artifact 才更新 Workflow 引用。
- 用户批准当前 Workflow Draft 时才创建 ProductionSpec Revision；运行中修改从当前 Revision 派生新草稿。
- 支持 Prompt、参考、时长、旁白和 Take 选择的细修，并验证局部 Stage 失效与旧 Artifact 保留。

图片 tracer bullet 的放行条件：

1. `image.generate@1`、`image.crop@1`、`image.upscale@1` 进入同一 Operation Capability Registry，并同时派生 Agent tool、Toolbar、参数控件、Dispatcher 校验和测试。
2. Agent 或设计师创建 `输入 → Operation → 输出`，现有 PromptBar 编辑 generate/upscale Operation 的 Prompt Document，`@` chip 与输入边共用 Binding。
3. 本地 crop 可撤销直接执行；generate/upscale 通过一张方案卡对精确子图授权，未授权节点不能提交 Provider。
4. 每个 Provider Take 保存 Recipe Hash、Execution Prompt Snapshot、ProviderAttempt、费用与 Artifact；晚到旧 Recipe 结果不自动选中。
5. 一个 Agent 回合形成可见 ChangeSet；部分失败保留成功步骤与失败 Operation，时间线可定位、查看差异和按组撤销。
6. 页面重载后 Draft、Operation、Binding、Prompt、Take、selectedTake、ChangeSet 和布局全部恢复。
7. Fake Provider 覆盖成功、失败、取消、submission unknown、晚到结果和重载；真实 Provider Smoke Test 继续单独请求费用批准。
8. 视频、音频、Table Promotion 与其余图片工具不在本切片伪装完成，验收后按同一 Registry 契约迁移。
9. 本切片先由 Browser Draft Authority Adapter 持久化，所有调用方经过 Authority Port；代码中不存在同时直写 Zustand/localforage/Runtime 的第二路径。

### S4：完整制作闭环

- 实现 dry-run、路线报价、预算、Gate、run、retry-stage、replan、render、verify。
- Production Skill Creator 完成 import/validate/eval/pack。
- 用迁移后的 VOX Skill 跑一条 image-first 30 秒样片，并验证全程画布同步与单镜头重做。

## 验收标准

只有同时满足以下条件，才能宣称“AI 原生画布可以直接创作并支持设计师二次编辑”：

1. AI 创建的节点、连线、Prompt、参考素材、模型参数和二次处理步骤会实时出现在同一 Workflow Draft；结果型操作都有可展开的 Operation Node，设计师可直接继续编辑，不为每个可逆动作重复确认。
2. AI 与人工操作进入语义 Draft ChangeSet；设计师能查看“谁为什么改了什么”、关联任务与 Artifact 并按组撤销，关闭并重开工作区后仍从当前 Workflow Draft Authority 恢复。
3. 用户批准前不会创建可执行 Revision；批准时冻结的内容与画布预览一致。
4. 运行中修改不会原地篡改已批准 Revision，而是派生新草稿并在重新批准后只重跑受影响阶段。
5. 关闭 WebUI 后已批准任务继续；重开后 StageRun、节点状态和 Artifact 自动恢复，但不覆盖未批准草稿。
6. 每个画布结果能追溯到 StageRun、ProviderAttempt、Artifact、报价、验证报告及产生它的已批准 Revision。
7. Provider 付费提交、冻结 Revision、发布和不可恢复动作始终经过明确 Gate；Production Skill 与画布 Agent 全程无法读取 Secret 或绕过 Runtime 直接提交 Provider。
8. 每个项目任一时刻只有一个 Workflow Draft Authority；Browser Workspace 与 Local Data Service 的切换可验证、可失败回退且不会双写。
9. Workflow 操作提升到 Table 后不存在跨工作区节点双写；Table 试验不会污染 Workflow，发布与回退都有明确 ChangeSet 和 Artifact 版本。
10. 多个付费 Operation 通过一张方案卡按精确子图授权；新增节点不会继承旧授权，语义修改只要求受影响范围重新确认。
11. Agent 回合部分失败会恢复为 `partial` ChangeSet；成功步骤、失败节点、费用与 Artifact 事实均可见，按组撤销不会伪造撤回 Provider 副作用。
12. Agent 与设计师可并行修改不同对象；同节点/连线版本冲突返回可解释差异，人工修改不会被旧 Agent 快照覆盖。
13. Provider 晚到结果始终完成持久化与费用对账；Recipe 已变化时标记旧版本且不自动选中，用户可明确采用。
14. Operation Node 的语义 LOD 不隐藏错误、待确认或当前编辑步骤；折叠 chip 与完整卡片都能直接聚焦同一可编辑配方。
15. Draft Change Timeline 按语义 ChangeSet 提供差异、定位、撤销和失败重试；聊天不是操作记录的唯一入口。
16. 每个结果型 Operation 只有一份可编辑 Prompt Document；PromptBar、Agent、授权 Recipe Hash 和下游失效计算都读取同一权威。
17. 每个 ProviderAttempt/Take 引用不可变 Execution Prompt Snapshot；设计师能看到最终提交文本与源文档差异，增强结果不会静默覆盖 PromptBar。
18. `@` 引用、输入角色/顺序与画布边读取同一 Operation Input Binding；不存在独立 mention/reference/order/connection 真相。
19. Agent 创建节点不提交猜测坐标；Layout Planner 在不移动 pinned 节点的前提下确定位置，用户空间记忆不会被每回合重排破坏。
20. UI 与 Agent 能看到的操作集合、参数、输入输出、费用/确认级别完全来自同一版本化 Registry，不再维护漂移列表或任意 JSON 工具。
21. 首个图片 tracer bullet 从 Agent/PromptBar 建图到本地 crop、付费 generate/upscale、Take 与重载恢复完整闭环，不用未接线组件或后端结果上传冒充完成。
22. Browser-first 只代表实现顺序；Draft Authority Port 已隔离存储，页面关闭限制如实显示，且没有 Browser/Desktop 双写。
23. Flovart Agent 使用迭代工具循环并观察每步真实画布结果；one-shot JSON 命令批次退出主路径，长任务不靠 Agent 轮询。

## 关联决策

- [ADR 0058：以 AI 原生 Workflow Draft 驱动画布](../adr/0058-use-ai-native-workflow-draft.md)
- [ADR 0023：统一制作执行、授权与状态契约](../adr/0023-centralize-production-execution-contract.md)
- [ADR 0025：统一 Production Skill 契约与包边界](../adr/0025-standardize-production-skill-packages.md)
- [ADR 0052：使用一个负责的 Flovart Agent 与临时专家](../adr/0052-use-one-accountable-flovart-agent-with-specialists.md)
