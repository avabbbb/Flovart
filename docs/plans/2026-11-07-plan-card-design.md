# 生成计划卡（Plan Card）设计

状态：草案，待确认。未确认前不实现。

## 1. 目标

在任何付费生成提交前，用一张卡展示：服务/线路、模型、分辨率、时长、任务数、参考素材及其校验结果、预估额度、风险提示。用户确认后才提交。同一张卡覆盖：画布运行、Seedance 重试、Agent 单节点与批量运行。

非目标（v1）：本地转码（已决定不做）；内置官方价格表；卡内修改参数；批量卡逐行取消勾选；完成后对账 UI。

## 2. 现状（代码核对结论）

已有的部件，设计是在其上升级，不另起一套：

| 部件 | 位置 | 现状 | 缺口 |
|---|---|---|---|
| 生成闸门 | services/generationGate.ts | GenerationGateDetails = 服务、模型、媒体类型、任务数、estimatedCost；buildGenerationGateSummary 拼纯文本 | 没有分辨率、时长、参考、阻断项、风险提示 |
| UI 入口 | App.tsx:484 runWorkflowNodeFromUi | 外部生成节点一律弹 requestUiConfirm（“开始生成视频？”），超时自动取消 | 只有文本 |
| 确认宿主 | services/uiConfirm.ts + components/ConfirmHost.tsx | title/body/三个按钮，单例、新请求顶替旧请求、120s 超时、无宿主时返回 false | 无结构化 payload |
| 估价 | utils/usageMonitor.ts estimateApiCost | 按 Key 的 pricingRules（按产品模型 → 线路 → 整把 Key 的顺序匹配，支持 resolution/quality 变体，video_second/image/request） | 无规则返回 null；闸门读 params.durationSec，需核实 Seedance 节点实际字段名 |
| 预算 | assertApiBudget | 提交时硬上限抛错 | 卡上看不到，用户确认后才失败 |
| 参考硬限制 | runWorkflowGeneration（2c2de12） | 在置 loading 之后、确认卡之后才拦 | 用户先确认再被拒，体验倒置 |
| Seedance 重试 | components/PromptBar.tsx:1485 | window.confirm（可能再次扣费） | 与闸门可能连弹两次；风格不一致 |
| Agent 确认 | services/workflowAgentBridge.ts | workflow.node.run 已按节点生成 gates；多节点拼“批量运行 N 个节点，一次确认覆盖本批”文本 | 文本堆叠；不显示汇总与授权余量 |
| 自动模式授权 | services/agentSpendMandate.ts | 任务数必填上限、金额上限仅在全部同币种可估时生效；spendDemand 汇总 | 无 UI 呈现汇总/余量/拒绝原因 |

## 3. 数据模型

把 GenerationGateDetails 扩展为计划（保留旧字段，agentSpendMandate 与现有测试无需改写）：

~~~ts
interface GenerationGateDetails {
  // 既有
  serviceLabel: string;
  modelLabel: string;
  mediaType: 'image' | 'video';
  taskCount: number;
  estimatedCost?: { amount: number; currency: 'USD' | 'CNY' } | null;
  // 新增（全部可选，未知就不显示该行）
  nodeTitle?: string;
  routeLabel?: string;             // 线路 id/名称；备用线路时标注
  resolution?: string;             // '720p' / '1280×720'
  durationSec?: number;            // 视频
  aspectRatio?: string;
  references?: PlanReference[];
  costBasis?: 'pricing-rule' | 'unknown';  // 卡上一律标注“预估”
  budget?: { used: number; limit: number; currency: 'USD' | 'CNY'; wouldExceed: boolean };
  warnings?: PlanNotice[];         // 可继续
  blockers?: PlanNotice[];         // 有则确认按钮禁用
}

interface PlanReference {
  title: string;
  kind: 'image' | 'video' | 'audio';
  durationSec?: number; sizeBytes?: number; width?: number; height?: number;
  status: 'ok' | 'warn' | 'block';
  message?: string;                // 与预检报错同一文案
}

interface PlanNotice {
  code: 'retry-new-task' | 'route-fallback' | 'cost-unknown' | 'budget-near' | 'budget-exceeded' | 'reference-limit' | string;
  message: string;
}
~~~

说明：
- “预估额度”只来自用户在 Key 上配置的 pricingRules。未配置时显示“未知（以 AI 服务账单为准）”，并给一个“配置价格”的 extra 按钮跳设置。不内置价格表。
- 卡上费用行显示计算依据，如 ¥0.04/秒 × 8秒 × 1 = ¥0.32（预估）。需要 estimateApiCost 顺带返回命中的规则（新增可选返回字段，不改既有返回形状的调用方）。

## 4. 触发点与流程

### 4.1 画布运行（UI）

~~~text
runWorkflowNodeFromUi
  → requiresExternalGenerationGate？否 → 直接 run
  → 无 Key → 打开设置（既有）
  → buildGenerationPlan(node, capability, keys, project)   ← 新：解析参考 + 硬限制 + 预算
  → requestUiConfirm({ title, body: 文本摘要, plan })
  → 确认 → workflowExecutor.runNode → runWorkflowGeneration（仍保留硬限制作兜底）
~~~

关键变化：参考视频硬限制（时长/总长/大小/宽高比）和预算硬上限提前到卡上。有 blocker 时卡照常弹出但“生成”按钮禁用，并列出问题，不再“先确认后报错”。runWorkflowGeneration 里的同一检查保留（Agent/headless/恢复路径仍需要）。两处共用 providerGenerationAdapter.ts 的 validateReferenceSet 与 toReferenceCheckItems，以及 generationPlan.ts 的 deriveProductMode，文案一致。只含“分辨率越界且可算出目标尺寸”的问题（planReferenceTranscodes 有方案）在卡上是 warning：运行时会提议本机转码而不是失败；其余均为 blocker。主线路不可用时卡上不校验（运行时可能走备用线路）。

runPreflight（提示词优化与合规）留在执行阶段不动：它可能调用文本模型，不应在弹卡前耗时。

buildGenerationPlan 是异步的（要读参考素材元数据）。元数据未知则该项放行，与现有预检规则一致。解析超过 1s 先弹卡显示“正在核对参考”，完成后更新（v1 可先等待再弹，视实测耗时再定）。

### 4.2 Seedance 重试（合并）

去掉 PromptBar.tsx:1485 的 window.confirm。重试走同一闸门，计划带 warnings: [{ code: 'retry-new-task', message: '重试会创建一个全新任务，可能再次消耗额度' }]，标题改为“重试生成视频？”。一次重试只弹一张卡。
待核实：onRetry 是否经过 runWorkflowNodeFromUi。如果是，现在已经连弹两次；如果不是，重试路径需要接入闸门。

### 4.3 Agent 单节点与批量审批

- workflowAgentBridge 的 workflowConfirmRequest 已产出 gates，改为调用 buildGenerationPlan，并把 plan 列表放进 requestUiConfirm 的 payload。
- 批量卡 = 每节点一行（标题、模型、分辨率/时长、任务数、预估）+ 汇总行（spendDemand：总任务数、总预估；有任一未知则“部分未知”）。
- 任一节点有 blocker：整批不可批准，列出哪些节点被拦。v1 不做部分批准。
- 自动模式：evaluateSpendMandate 允许时不弹卡（既有行为）；拒绝时卡上显示原因（如“超出本次授权：已用 8/10，本批 4 个”，用 describeSpendMandate）。首次开启授权的卡上显示默认上限（defaultMandateTasks）。
- Agent CLI/无宿主时仍用文本 body，由同一计划生成，保证两端一致。

## 5. UI

- UiConfirmOptions / UiConfirmRequest 新增可选 plan?: { items: GenerationGateDetails[]; mandate?: string }。ConfirmHost 在有 plan 时渲染 GenerationPlanCard，否则保持现状。单例、超时、顶替、Esc 取消等语义不变。
- 新增 confirmDisabled?: boolean（有 blocker 时为 true）。
- 卡片字段顺序：模型与线路 → 分辨率 · 时长 · 比例 · 任务数 → 参考列表（缩略名 + 时长/大小/尺寸 + 状态图标）→ 预估额度（含依据）→ 预算余量 → warnings → blockers。未知字段不占行。
- 卡片不阻塞画布（与现有 ConfirmHost 一致）。中英文走 ui()/translations。

## 6. 风险与待核实

1. Seedance 节点的时长/分辨率字段名是否为 durationSec/resolution。如果不是，现在视频估价会按 1 秒算（这是既有缺陷），需在任务 1 中修。
2. 弹卡前解析参考的耗时（远程素材可能需要 HEAD/读 blob）。
3. onRetry 路径是否已经过闸门。
4. 竞品对照（LibTV/即梦/Higgsfield 每步展示积分再 Approve）来自公开资料，未实地验证。

## 7. 任务拆分与验收

**T1 计划数据与估价依据**（generationGate.ts、usageMonitor.ts）
- 扩展 GenerationGateDetails；新增 buildGenerationPlan（异步，含参考解析、硬限制、预算）；estimateApiCost 可选返回命中规则；核实并修正时长/分辨率字段。
- 验收：单测覆盖下列情形。Seedance 8s 720p 带 ¥0.04/秒规则 → ¥0.32 且带依据；无规则 → costBasis:'unknown'；参考 16s → blocker；参考元数据未知 → 放行；预算会超 → budget-exceeded blocker。现有 generationGate/agentSpendMandate 测试不改也通过。

**T2 硬限制共用**（workflowGeneration.ts）
- 不另抽函数：复用 validateReferenceSet；把 canonical 参考 → ProviderReferenceCheckItem 的映射抽成 toReferenceCheckItems，provider 与 userScript 适配器、buildGenerationPlan 共用。
- 验收：原 73 个相关用例仍然通过；两处对同一输入给出相同文案。

**T3 确认宿主结构化 + 计划卡组件**（uiConfirm.ts、ConfirmHost.tsx、新 GenerationPlanCard.tsx）
- 验收：uiConfirm.test.ts 全部通过；新测试覆盖三点：有 plan 时渲染各字段、未知字段不显示、confirmDisabled 时确认按钮不可点且 Enter 不提交。

**T4 画布入口接入 + 重试合并**（App.tsx、PromptBar.tsx）
- 验收：点运行只弹一张卡；Seedance 重试只弹一张卡，含“可能再次消耗额度”；代码中不再有该 window.confirm；参考超限时卡上有红色提示且无法提交，整个过程未发出任何生成请求。

**T5 Agent 批量审批**（workflowAgentBridge.ts、agentSpendMandate.ts）
- 验收：多节点 workflow.node.run 弹一张卡，含每行与汇总；有 blocker 时整批拒绝，返回给 Agent 的错误包含被拦节点；授权内自动批准不弹卡；超授权时卡上显示原因与余量；文本 body 与卡片数据同源。

**T6 验证**
- tsc --noEmit 通过；上述测试全部通过；按 provider/reference/workflowGeneration/generationGate/agent 过滤的全量运行无失败；用本地 vite 打开画布截图确认卡片显示。

顺序：T1 → T2 → T3 → T4/T5（可并行）→ T6。
