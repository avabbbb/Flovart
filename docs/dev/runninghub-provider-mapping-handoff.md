# RunningHub Provider 映射施工清单

## 当前结论

当前代码不能声明 Product Model 映射后的 RunningHub Provider 已可正常使用。局部测试与 Vite 构建通过不等于真实 Workflow 入口、按 Generation Mode 选路和最终 Provider Request 已贯通；在完成下列改造、Route Contract Test 与经用户批准的 Provider Smoke Test 之前，只能报告“设计已确认”或“契约已验证”，不能报告“线上已可用”。

## 权威输入

- 领域词与边界：[CONTEXT.md](../../CONTEXT.md)
- 16 条首期线路及官方依据：[RunningHub 首期 Route Catalog](runninghub-route-catalog.md)
- 决策：[0027 按模式绑定](../adr/0027-bind-product-models-to-provider-routes-by-mode.md)、[0028 Schema 与 Adapter](../adr/0028-own-provider-parameters-in-route-schemas-and-adapters.md)、[0029 未验证 Route 禁止执行](../adr/0029-require-verified-route-schemas-before-execution.md)、[0030 价格预估](../adr/0030-preview-route-price-without-making-it-an-availability-gate.md)、[0031 验收](../adr/0031-verify-every-route-contract-and-smoke-test-each-mode.md)、[0032 低价默认](../adr/0032-prefer-low-price-routes-by-default.md)、[0033 参数冲突](../adr/0033-drive-controls-and-preflight-from-route-schemas.md)

## 必须先修的阻断项

1. `App.tsx` 当前把一个对象传给 `runWorkflowGeneration`，而 `services/workflowGeneration.ts` 的实现签名是 `(project, nodeId, runtime)`；先统一接口并用真实入口测试覆盖，不能依赖 Vite 跳过类型检查。
2. `services/productModelCatalog.ts` 的映射仍以 `productModelId + upstreamModelId` 为核心，`resolveProductModelRoute` 不接收 Generation Mode；改为 `Product Model + Generation Mode + Route ID + Credential` 的绑定，并保留优先级、启用与用户确认状态。
3. `utils/modelRefs.ts` 虽接收 image/video capability，但产品模型分支最终仍调用不区分 Generation Mode 的路由解析；必须把实际 submode（文生、图生、首尾帧、多模态）传到同一解析器。
4. `services/aiGateway.ts` 的 `RUNNINGHUB_STANDARD_MODEL_DEFAULTS` 与 `buildRunningHubStandardPayload` 依赖 endpoint 正则和集中式特例，不能成为新实现真相源；16 条 Route 必须各自由 Route Capability Schema 与 Provider Adapter 负责。
5. RunningHub 图片分支目前只把参考图传给通用 payload builder，宽高比、分辨率、质量等用户意图可能丢失；视频分支也没有完整传入音频生成、联网搜索、真人检查、seed、返回尾帧等 Route 参数，并存在硬编码默认值覆盖用户选择的风险。
6. `services/runningHubService.ts` 的文档 endpoint 映射只覆盖用户清单的一部分；Route Catalog 必须保存精确 endpoint，完整文档 URL 只作为证据，不能靠 URL 归一化失败后的猜测执行。
7. CLI 的 `models.list` 与 `provider.select-model` 示例仍混有裸上游 ID 和 `flovart:*` Product Model ID；WebUI、Workflow 与 CLI 必须共享同一 Product Model 和 Route Binding 契约。

## 建议施工顺序

1. 定义 `GenerationMode`、`RouteId`、`RouteCapabilitySchema`、`ProductRouteBinding` 和 provider-neutral `GenerationRequest`；不要兼容旧映射结构，项目尚未上线，直接按新设计收敛。
2. 将 16 条 Route 编成显式、版本化目录；每条记录 Product Model、mode、endpoint、渠道等级、参数 Schema、媒体角色/数量、序列化类型、默认值和官方证据。
3. 为 RunningHub 实现 Route Preflight 与 Adapter；同一 Adapter 产出的 Provider Request 同时供价格预估与正式提交使用。
4. 改造产品模型解析、设置页映射和 PromptBar 控件：原始模型名为主，Provider Route Label 显示 RunningHub 别名与低价/稳定等级，控件取 Product Model 与最终 Route Schema 的交集。
5. 接入 `POST /openapi/v2/price-preview/<route>`；只有预算超限阻止提交，价格失败显示未知和警告。ProviderAttempt 开始后锁定 Route，不自动改线。
6. 修复 Workflow 真实入口，并统一 Canvas/Workflow/CLI 走相同解析与 Adapter；删除被取代的正则默认值和重复字段特例，避免双轨继续存在。
7. 为每条 Route 添加契约测试，再补真实入口测试、价格/预算测试、Submission Unknown 与无自动 Failover 测试。

## 放行标准

- 16 条 Route 各自有 endpoint、字段名、字段类型、默认值、媒体角色与数量限制的 Route Contract Test。
- 图片和视频各模式都从 Product Model 经 Generation Mode 解析到确定 Route，最终请求体不丢弃或静默改写用户已选参数。
- 价格预估与正式提交使用字节语义一致的业务 payload；仅 URL 前缀不同。
- 查询统一使用 `/openapi/v2/query`，认证、上传、提交、轮询、结果解析和 Submission Unknown 均有测试。
- 项目类型检查、相关测试和构建分别通过；不能用“Vite build 通过”替代 TypeScript 检查。
- 真实 Provider Smoke Test 仅在用户单独批准费用后执行；未实测时交付说明必须明确标注。

## 非目标

第一阶段不实现 Grok 视频编辑、DreamActor 动作模仿、Suno 音乐、旧 status/outputs 查询接口或 webhook 运维接口，也不顺手重构无关 Canvas、Workflow 拓扑、Provider 数据层或用户现有 UI。
