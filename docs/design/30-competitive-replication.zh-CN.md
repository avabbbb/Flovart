# 机制级复刻方案：LibTV / RunningHub RHTV / Higgsfield → Flovart

> 状态：**Working plan**（2026-10-30）。竞品机制来自用户提供视频的逐帧观察与公开资料；标注「待复核」的条目尚未对照官方文档确认。Flovart 侧状态只写代码与测试可证实的内容。
> 约束：遵守 [Agent 模块](12-agent.md)（CLI + Skill 为默认路径、MCP 仅投影、`tools/flovart/registry.js` 唯一来源、不做全页 Agent 聊天）与本地优先执行（ADR 0002 / 0010）。

## 1. 状态图例

- **已实现✓**：代码 + 测试本轮已验证。
- **已有**：代码存在，本轮未专门回归。
- **部分**：只有流程约定或单点能力，缺数据模型/UI。
- **缺口**：未找到实现。

## 2. 机制对照矩阵

| # | 机制 | 竞品做法 | Flovart 对应 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 无限画布 + 节点工作流 | LibTV 画布节点串联生成；RHTV 基于 RunningHub 工作流节点 | `components/workflow/InfiniteWorkflow.tsx`、`services/workflowOperationExecution.ts` | 已有 |
| 2 | Agent 对话驱动画布 | LibTV 侧栏 Agent 直接建节点、连线、运行 | `services/browserAgentKernel.ts`（内置 Assistant）、`workflowAgentBridge.ts`、CLI `workflow.apply / workflow.node.run` | 已有 |
| 3 | Skill：输入槽位 | LibTV Skill 参数表单（文本/图/视频/音频） | `services/skillInputs.ts`；text/longtext/image/video/audio/choice，≤ 12 | 已实现✓ |
| 4 | Skill：手动 / 自动模式 + 费用授权 | 自动模式下一次性确认批量费用 | `agentSpendMandate.ts`、`generationGate.ts`；授权上限、超限重新确认 | 已实现✓ |
| 5 | 参数继承 | 新建/下游节点沿用模型与风格 | `services/generationInheritance.ts`；不继承 count / seedanceRefs / operationParameters | 已实现✓ |
| 6 | Skill 编写与安装 | Skill CLI 生态（待复核具体命令） | `tools/flovart/skill-commands.js` `skill.init / skill.validate`；`skillHubClient.ts`、`localSkillRegistry.ts` | 已实现✓ |
| 7 | 短剧流程：锚点 → 拆镜 → 批量 → 报告 | LibTV/Higgsfield 先定角色与场景，再拆镜批量出片 | `WorkflowNode.shot`（镜号/时长/场景/机位/台词）+ `services/shotPlanning.ts` 排序与校验；`tests/shotPlanning.test.ts` | 已实现✓ |
| 8 | 角色/风格一致性 | Higgsfield 角色 ID 类机制（待复核）；LibTV 锚点图引用 | `WorkflowNode.anchor` + `services/anchorLock.ts`；`runWorkflowGeneration` 镜头生成前自动接入已批准锚点、未批准则阻断；节点标题栏批准/取消按钮（`services/anchorApproval.ts`，走 `update_node` 可撤销）；`tests/anchorLock.test.ts`、`tests/anchorApproval.test.ts`、`tests/workflowGeneration.test.ts` | 已实现✓ |
| 9 | 视频截帧 / 音视频分离自动上画布 | 生成后可一键抽帧续接 | `services/autoMediaDerive.ts`（默认关闭，工具栏 3 个开关）、`workflowVideoOperations.ts` | 已实现✓ |
| 10 | 成片拼接 / 时间线 | 逐镜拼接成片 | `video.merge@1` 按 `shot.index` 排序后调用 `mergeVideos`；时间线精修交给 Resolve（刻意不内置）；`tests/workflowVideoOperations.test.ts` | 已实现✓ |
| 11 | 多模型路由 | RHTV 聚合 RunningHub 路由 | ADR 0027 schema 路由、`runninghub-route-catalog.md`、`aiGateway.ts` | 已有 |
| 12 | 用量与费用透明 | 积分/费用展示 | `services/tokenUsage.ts` + 设置「用量」页（来源筛选、缺失计数）；流式由 `services/sse.ts` + `services/streamUsage.ts` 统一结算（见 [32 流式用量](32-stream-usage.zh-CN.md)）；图片/视频费用由 `services/mediaUsage.ts` 汇总 `utils/usageMonitor.ts`；`tests/streamUsage.test.ts`、`tests/mediaUsage.test.ts` | 已有（无 usage 的流只计次数） |
| 13 | 时延观测 | — | `services/providerLatency.ts` `trackLatency`（ttfb 标记） | 已有 |
| 14 | CLI / MCP 对外 Agent | Skill + CLI 生态 | ADR 0070；`tools/flovart/registry.js`、`mcp-server.js` | 已有 |

## 3. 缺口方案（每项 3 选 1）

### P0-A 结构化分镜（机制 7）

- A1 继续只靠 Agent 提示词拆镜：零改动，但镜号/时长不可校验，失败重跑靠标题匹配。
- A2 新增独立 Storyboard store：功能完整，但违反「不做第二套业务实现 / Host 专属 store」。
- **A3（采用）** 在现有工作流节点上加可选 `shot` 元数据（`index`、`durationSec`、`anchorNodeIds`），`workflow.apply` schema 校验，Agent 系统提示改为写入该字段。节点仍是唯一事实，拼接与重跑按 `shot.index` 排序。
- 验收：schema 测试；「只重跑失败镜头」按 shot 筛选的单测。

### P0-B 角色/风格锁定（机制 8）

- B1 训练/上传角色模型：依赖具体厂商，成本高，不符合本地优先。
- B2 在提示词里重复角色描述：便宜但一致性弱。
- **B3（采用）** 锚点节点「已批准」标记（ADR 0059）：下游生成节点自动把已批准锚点作为参考图注入（受模型 `multimodalSlots.image.max` 限制），并与参数继承共用候选选择逻辑。未批准前 Agent 不拆镜（与现有提示一致）。
- 验收：注入顺序/上限单测；未批准锚点不注入。

### P1-C 成片拼接（机制 10）

- C1 完整时间线编辑器：工作量大，与 Resolve 宿主重叠。
- C2 导出 EDL/FCPXML 交给宿主：专业但门槛高。
- **C3（采用）** 「拼接」Operation：选中或按 `shot.index` 排序的视频节点 → `mergeVideos` → 新视频节点；精修交给 Resolve 宿主（已有宿主路径）。

### P1-D 用量覆盖面

- 已覆盖：文本生成、提示词润色、非流式与流式反推（Gemini / Anthropic / OpenAI 兼容）、内置 Agent。流式在完成/取消/出错时各结算一次；全程无 usage 只记 missing 次数，不估算。
- 已覆盖：图片/视频费用（2026-10-30，`services/mediaUsage.ts` 只读汇总 usageMonitor 的预估/实际费用，不改请求）。
- 默认仍「被动读取、不改请求」；`stream_options.include_usage` 仅在 Key 级 opt-in 时发送，400 自动降级。
- 未覆盖：托管 Agent 的服务端 usage。

## 4. 稳定性 / 时延 / 输出优化（相对竞品的增量）

- ffmpeg 任务串行队列（`enqueueFFmpegTask`），避免虚拟文件系统冲突；无音轨分离给出明确错误。
- 自动派生排除 operation 输出，防递归；项目首次加载不触发。
- 文本生成固定低温与可选 seed；提示词润色仅在格式失败时重试一次，不放大费用。
- 费用授权与工具权限分离；批量一次确认，失败只重跑失败节点。
- 下一步建议：用 `providerLatency` 的 ttfb 数据与 `tokenUsage` 合并为按模型的性价比视图（仅统计）。

## 5. 不采用

全页 Agent 聊天；独立 Storyboard store；内置完整时间线；云端角色模型训练；为统计 usage 改写请求体。

## 6. 验证记录（2026-10-30）

- Skill 相关：全量曾通过 61 文件 / 478 测试；`tsc --noEmit` clean。
- 媒体自动派生：3 文件 / 15 测试通过。
- Token 用量：gateway/浏览器 Agent 回归 6 文件 / 114 测试；用量页与设置 5 文件 / 26 测试；`tsc` clean。
- 锚点批准按钮 + 媒体费用：`tests/anchorApproval.test.ts`、`tests/mediaUsage.test.ts` 与用量页/锚点/ops 回归 5 文件 / 25 测试通过；`tsc` clean。
