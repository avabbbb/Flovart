# Production Runtime S0/S1 施工清单

## 状态

本文把已确认的 [Production Runtime V1 实施规划](production-runtime-v1-plan.md) 与 [数据契约](production-runtime-data-contract.md) 拆成文件级、测试级施工批次。S0.1 与 S0.2 已实现并进入待测试状态；S1 及后续批次仍是实施输入，不代表已经完成。

固定范围：

- S0 只建立安全、单一、可发现的本地 Control Plane。
- S1 只完成一条可持久、可恢复的图片生成 tracer bullet。
- 每批先写失败测试，再写最少实现；批次必须独立通过验收，不能把未完成状态藏到下一批。
- 不改 Workflow、Table、Agent 的视觉设计，不恢复旧 Canvas / Art。
- 不接入视频、VOX、TTS、音乐或成片渲染；`tools/flovart/prototypes/vox-film/` 在 S4 前保留为验收素材，不作为生产 Runtime。
- 自动化测试只使用 Fake Provider。任何真实付费 Provider smoke test 都需要用户单独确认。

## 当前替换边界

| 现有实现 | 当前问题 | S0/S1 目标 |
| --- | --- | --- |
| `tools/flovart/core.js` 内硬编码 `COMMAND_REGISTRY` | CLI、MCP、Skill 与 Runtime 会漂移 | 从一份 Canonical Registry 读取 |
| `tools/flovart/runtime-client.js` | 实际通过 CDP 执行 `window.__flovartAPI` | 发现 Desktop Runtime 并调用带鉴权的 Local HTTP |
| `tools/flovart/flovart-bridge.js` | 文件队列依赖浏览器存活，没有可靠 receipt、lease、recovery | 删除，由 SQLite Task/Event Ledger 取代 |
| `tools/flovart/browser-commands.js` | 把长任务重新路由给浏览器 | 删除，CLI/MCP 只调用 Runtime |
| `src-tauri/src/http.rs` | 固定 `7421`、缺少 Bearer 鉴权、可以返回原始 Secret | 随机 loopback 端口、启动期 token、永不返回 Secret |
| `src-tauri/src/bridge.rs` | 内存队列，重启即丢执行状态 | 删除，由 `ProductionRuntime` 持久任务核心取代 |
| `src-tauri/src/bin/host.rs` | 写死 `127.0.0.1:7421` | 读取 Runtime Discovery Record，并附带启动期 token |
| `services/flovartRuntime.ts` | 只是浏览器全局 API 类型，并非 Runtime Client | 改为 WebUI 的类型化 Tauri Adapter；不执行 Provider 网络请求 |
| `services/workflowDispatcher.ts` | 幂等缓存只在浏览器内存 | 图编辑保留在 UI；生产写命令的幂等与 revision 由 Runtime 持久化 |
| `services/workflowGeneration.ts` | Prompt、路由、Provider、下载、历史和图更新揉在浏览器流程 | S1 抽出纯请求构造；图片执行权转移到 Runtime/Provider Worker |

## 批次顺序

```text
S0.1 Canonical Contract + Runtime Kernel
  -> S0.2 Secure Control Plane
  -> S1.1 Durable Task/Event Ledger
  -> S1.2 Fake Image End-to-End
  -> S1.3 Real Image Adapter + Hard Cutover
```

前一批未满足删除门槛和验收命令时，不开始后一批。每个批次建议单独提交，便于定位契约回归。

## S0.1 Canonical Contract + Runtime Kernel

### 目标

建立唯一命令契约和最小 `ProductionRuntime` 接口。此批不监听端口、不访问 Keyring、不运行 Provider。

### 新增文件

- `tools/flovart/contracts/runtime/command-registry.v1.json`
- `tools/flovart/contracts/runtime/schemas/command-registry.v1.json`
- `tools/flovart/contracts/runtime/schemas/command-envelope.v1.json`
- `tools/flovart/contracts/runtime/schemas/task-receipt.v1.json`
- `tools/flovart/contracts/runtime/schemas/runtime-error.v1.json`
- `tools/flovart/contracts/runtime/schemas/runtime-status.v1.json`
- `src-tauri/src/runtime/mod.rs`
- `src-tauri/src/runtime/contracts.rs`
- `src-tauri/src/runtime/registry.rs`
- `src-tauri/src/runtime/error.rs`
- `src-tauri/tests/runtime_contract.rs`
- `tools/flovart/registry.js`
- `tests/flovartRuntimeRegistry.test.ts`

### 修改文件

- `src-tauri/src/lib.rs`：注册 `runtime` module，只暴露最小 `runtime.status` Tauri command。
- `src-tauri/Cargo.toml`：加入成熟的 UUID v7、SHA-256、RFC 8785 canonical JSON 与 JSON Schema 校验依赖；具体版本在实施时按当前 Rust toolchain 锁定。
- `tools/flovart/core.js`：移除手写 registry 数据，保留 CLI 参数归一化与展示逻辑。
- `tools/flovart/mcp-server.js`：MCP tool 描述继续从 `core.js` 导出的同一 registry 生成。
- `tools/flovart/package.json`：把 `contracts.js`、`registry.js` 与 `contracts/runtime/**` 纳入发布文件。
- `tests/flovartRuntimeRegistry.test.ts`、`tests/workflowCli.test.js`：验证 Canonical Registry 与现有 Workflow 命令回归边界。

### RED 测试

1. Rust 与 Node 读取同一 registry 后，命令名、协议版本和 Registry 内容 hash 完全一致。
2. registry 出现未知字段、重复命令、缺失 schema 或 schema `$id` 不匹配时启动失败。
3. `CommandEnvelope` 拒绝未知字段、未知命令和非 v1 协议。
4. UUID v7 由库生成；相同 canonical JSON 得到相同 payload hash，键顺序变化不改变 hash。
5. CLI `command.list`、`command.schema` 与 MCP 暴露相同命令集合。
6. Registry 不重新出现 `canvas.*`、`element.*` 或已删除的旧 `workflow.run`。

### 首批命令

S0.1 registry 共登记 43 条当前命令，但只有以下 3 条标记为 `available`：

- `runtime.status`
- `command.list`
- `command.schema`

现有其他命令保留用于迁移期间的 CLI/MCP 兼容，但统一标记为 `legacy-only`，不能伪装成已由 Production Runtime 支持。S1 每完成一条真实垂直切片，再把相应命令状态改为 `available`。S0.2 完成安全发现前，CLI 调用 `runtime.status` 稳定返回 `RUNTIME_UNAVAILABLE`，不回退 shadow runtime。

### 删除门槛

- 本批不删除旧执行路径。
- `tools/flovart/core.js` 的硬编码 registry 只能在 Rust/Node 双端契约测试通过后删除。

### 验收

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --test runtime_contract
npm test -- tests/flovartRuntimeRegistry.test.ts tests/workflowCli.test.js tests/flovartActionRegistry.test.ts
npm run flovart:cli -- command.list --json
```

## S0.2 Secure Control Plane

### 目标

让 CLI、MCP、Native Host 和 WebUI 到达同一个 Runtime Module；关闭 CDP、固定端口和 Secret 读取面。

### 实施状态

- 已完成：Desktop 启动唯一 `ProductionRuntime`，WebUI 通过受限 Tauri IPC 调用，CLI/MCP/Native Host 通过受保护 Discovery Record 连接随机 loopback 端口。
- 当前 Control Plane 只开放 `GET /v1/status` 与 `POST /v1/commands`，且两条路由都必须携带启动期 Bearer Token；带浏览器 `Origin` 的请求直接拒绝，不返回 CORS 头。
- 当前只有 `runtime.status`、`command.list`、`command.schema` 三条只读命令可执行。Provider、Task、生成、VOX 与成片制作仍属于后续批次。

### 新增文件

- `src-tauri/src/runtime/control_server.rs`
- `src-tauri/src/runtime/discovery.rs`
- `src-tauri/src/runtime/auth.rs`
- `src-tauri/tests/runtime_control_server.rs`
- `tests/flovartRuntimeClient.test.ts`

### 修改文件

- `src-tauri/src/lib.rs`：Tauri App State 持有唯一 `ProductionRuntime`，Tauri IPC 与 Control Server 共用该实例。
- `src-tauri/src/http.rs`：已删除；Control Server 只保留 `runtime/control_server.rs` 一套路由表。
- `src-tauri/src/bin/host.rs`：读取 Discovery Record，不再使用常量端口；转发时附带 Bearer Token。
- `src-tauri/src/keyring.rs`：原始 Secret 读取只保留为 Rust 内部函数，不再注册 Tauri/HTTP 读取命令；WebUI 仍可写入、删除和列出脱敏 metadata。
- `tools/flovart/runtime-client.js`：用 Discovery Record + Local HTTP 取代 CDP/WebSocket。
- `tools/flovart/cli.js`、`tools/flovart/mcp-server.js`：只通过新的 Runtime Client 调用可用命令。
- `services/flovartRuntime.ts`：定义 WebUI 到 Tauri command 的类型化 adapter，不再读取 `window.__flovartAPI` 作为生产执行面。
- `tests/runtimeBridgeState.test.ts`：改成验证 Runtime discovery/availability，不再把浏览器全局对象当 Runtime 可用证据。

### Control Plane 约束

- 监听 `127.0.0.1:0`，由操作系统分配随机端口。
- 每次 Desktop Runtime 启动生成至少 256 bit 随机 token。
- Discovery Record 只允许当前系统用户读取：Unix 使用 `0600`；Windows 使用当前用户 SID 的显式 DACL。写入采用临时文件 + 原子 rename。
- Discovery Record 至少包含 `protocolVersion`、`pid`、`port`、`startedAt`、`token`。token 不是 Provider Key，但仍按本机凭据处理，不写日志。
- 所有 `/v1/**` 路由都必须鉴权；不存在匿名 health/handshake。
- 客户端拒绝协议、Registry Hash、权限或 Runtime Instance 不匹配的 discovery；正常退出只删除自己创建的 record。
- 不信任浏览器 `Origin`、空 `Origin` 或 CORS 作为身份认证。
- `/state/keys/:provider/:keyId` 原始 Secret 读取路由必须在本批删除。

### RED 测试

1. 无 token、错误 token、畸形 Authorization 都返回 `401`；正确 token 才能访问 `/v1/status`。
2. 服务每次启动使用随机端口和新 token；测试输出、panic、HTTP error 均不包含 token。
3. stale PID、错误 protocol、权限过宽的 discovery 都被客户端拒绝并返回 `RUNTIME_UNAVAILABLE` 或 `PROTOCOL_MISMATCH`。
4. Native Host 与 Node Runtime Client 对同一 Runtime 返回相同 status。
5. 搜索所有 HTTP 响应序列化路径，不能得到 `secret`、`apiKey`、`Authorization` 或 Keyring 值。
6. Desktop Runtime 未启动时，CLI 在 2 秒内确定失败，不再等待浏览器 30 秒。

### 删除门槛

以下条件全部成立后删除 CDP 客户端代码和原始 Secret GET 路由：

- Tauri IPC、Node Runtime Client、Native Host 三条 adapter 集成测试均通过。
- CLI `runtime.status` 在 Desktop 开启/关闭两种情况下都有稳定结果。
- Provider Key 仍可由 WebUI 通过 Tauri command 写入和列出脱敏 metadata。

### 验收

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --test runtime_control_server
npm test -- tests/flovartRuntimeClient.test.ts tests/runtimeBridgeState.test.ts
npm run flovart:cli -- runtime.status --json
```

## S1.1 Durable Task/Event Ledger

### 目标

先用无外部副作用的 `runtime.test.delay` 证明 receipt-before-side-effect、持久任务、幂等、租约恢复、取消和事件续传；没有这些证明前不接真实图片 Provider。

### 新增文件

- `src-tauri/src/runtime/migrations/0001_runtime_ledger.sql`
- `src-tauri/src/runtime/store.rs`
- `src-tauri/src/runtime/commands.rs`
- `src-tauri/src/runtime/tasks.rs`
- `src-tauri/src/runtime/events.rs`
- `src-tauri/src/runtime/worker.rs`
- `src-tauri/src/runtime/test_capability.rs`
- `src-tauri/tests/runtime_ledger.rs`
- `src-tauri/tests/runtime_recovery.rs`
- `tests/flovartRuntimeTasks.test.ts`

### 修改文件

- `src-tauri/src/state.rs`：只负责打开同一个 SQLite 文件和通用连接配置；Production Runtime 表由自己的 migration 管理，不塞回 `kv`/`sync_log`。
- `src-tauri/src/runtime/mod.rs`：实现已确认的五个 seam：`submit`、`getTask`、`listTasks`、`cancelTask`、`streamEvents`。
- `tools/flovart/contracts/runtime/command-registry.v1.json`：启用 `runtime.test.delay`、`task.get`、`task.list`、`task.cancel`、`event.stream`。
- `tools/flovart/runtime-client.js`、CLI、MCP：增加 task 查询、取消和 SSE reconnect。

### 数据范围

本批只建 `command_receipts`、`runtime_tasks`、`runtime_events` 与 migration version 表。S1 图片实体表放到下一批；不提前创建 S2/S3 预算、Gate、Route Plan 表。

### RED 测试

1. `command_receipts + runtime_tasks + 首事件` 在 worker 领取前同事务提交。
2. 相同 actor + idempotency key + payload 返回同一 receipt；payload 不同返回 `IDEMPOTENCY_CONFLICT`。
3. Runtime 在任务执行中被重建后，过期 lease 被重新领取；未过期 lease 不会并发执行。
4. `cancel_requested_at` 持久化，协作式 worker 在下一个安全点终止并发出终态事件。
5. `Last-Event-ID` 只返回之后的事件；断线重连不漏、不重复业务副作用。
6. 重启后 `task.get` 和 `task.list` 仍返回一致投影。
7. SQLite busy、磁盘写失败时不返回已接受 receipt，也不启动 worker 副作用。

### 删除门槛

- 本批仍不删除旧 BridgeQueue，但新任务测试不得引用它。
- `sync_log` 不得被包装成新 Task Ledger。

### 验收

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --test runtime_ledger --test runtime_recovery
npm test -- tests/flovartRuntimeTasks.test.ts
```

## S1.2 Fake Image End-to-End

### 目标

不使用 API Key，用确定性 Fake Image Provider 跑通 `ProductionSession -> Spec Revision -> Run -> Stage -> Task -> Artifact -> Workflow Projection`，并证明 WebUI 关闭和 Runtime 重启后可恢复。

### 新增文件

- `src-tauri/src/runtime/migrations/0002_image_slice.sql`
- `src-tauri/src/runtime/production.rs`
- `src-tauri/src/runtime/capability.rs`
- `src-tauri/src/runtime/artifacts.rs`
- `src-tauri/src/runtime/workflow_projection.rs`
- `src-tauri/src/runtime/fake_image_provider.rs`
- `tools/flovart/contracts/runtime/schemas/capability-submit-image.v1.json`
- `src-tauri/tests/runtime_fake_image.rs`
- `src-tauri/tests/runtime_artifact_store.rs`
- `services/productionRuntimeClient.ts`
- `services/workflowRuntimeAdapter.ts`
- `tests/workflowRuntimeAdapter.test.ts`

### 修改文件

- `tools/flovart/contracts/runtime/command-registry.v1.json`：启用 `production.session.create`、`production.spec.create`、`production.run`、`capability.submit`、`generate.image`、`artifact.get`。
- `services/workflowGeneration.ts`：只抽取图片 Prompt/引用/节点输入构造的纯函数；Fake 路径不能调用 `executeUnifiedIgnition`。
- Workflow store 接入 adapter：只消费 Runtime 返回的 Artifact ID 与带 revision 的 projection op，不直接认 Provider URL 为长期结果。
- `tools/flovart/core.js`、CLI、MCP：把 `generate.image` 映射为同一个 `capability.submit` 意图，不创建旁路实现。

### 数据范围

创建数据契约中以下 S1 表：

- `production_sessions`
- `production_spec_revisions`
- `production_runs`
- `stage_runs`
- `stage_dependencies`
- `provider_attempts`
- `artifacts`
- `artifact_relations`
- `artifact_provenance`
- `workflow_projects`
- `workflow_plan_projections`
- `workflow_layouts`

Fake Provider 同样写 `provider_attempts`，但 `provider_id = "fake"`，不得绕过真实状态机。

### RED 测试

1. Fake 输入完全相同则输出相同 PNG bytes 和 SHA-256；Artifact Store 按内容去重。
2. TaskReceipt 在 Fake Provider 被调用前已能从第二个数据库连接读取。
3. Artifact 使用临时文件、hash 校验、原子 rename；数据库只引用最终相对路径。
4. Runtime 在 `submitted`、Artifact 写临时文件后、Projection 提交前三个故障点重启，都能恢复到唯一正确终态。
5. 同一 Spec/Run 投影得到相同 `projection_hash`；纯布局变更只增加 `layout_revision`。
6. 过期 `expectedRevision` 返回 `PRECONDITION_FAILED`，不覆盖用户图状态。
7. CLI、MCP、WebUI 提交相同 envelope 时得到同一 task/status/event 语义。
8. 事件和 Workflow snapshot 不包含 PNG base64、Provider URL、完整 Prompt 或本地绝对路径。

### 删除门槛

- Fake 图片从提交到恢复的全部测试通过后，才允许接真实 Provider Worker。
- 此批不删除当前 UI 的真实图片路径；但新 Runtime 路径必须有显式开发开关，不能静默 fallback 到浏览器 Provider。

### 验收

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --test runtime_fake_image --test runtime_artifact_store
npm test -- tests/workflowRuntimeAdapter.test.ts tests/workflowDispatcher.test.ts
npm run flovart:cli -- generate.image --prompt "runtime fake smoke" --json
```

## S1.3 Real Image Adapter + Hard Cutover

### 目标

让一条现有图片 Product Model Route 在受控 Provider Worker 中执行；随后把 CLI、MCP 和 WebUI 图片生成切到唯一 Runtime Authority，并删除旧 Bridge 路径。

### 新增文件

- `src-tauri/src/runtime/provider_worker.rs`
- `tools/flovart/provider-worker/index.mjs`
- `tools/flovart/provider-worker/protocol.mjs`
- `tools/flovart/provider-worker/image-adapter.mjs`
- `tests/flovartProviderWorker.test.ts`
- `src-tauri/tests/runtime_provider_worker.rs`
- `src-tauri/tests/runtime_image_cutover.rs`

### 修改文件

- `services/aiGateway.ts`、`services/workflowGeneration.ts`：把首条图片 Route 的纯请求映射提取到浏览器/worker 可共用的无状态函数；不得把 `window`、store、`FileReader` 或 Blob URL 带入 Worker。
- `src-tauri/src/keyring.rs`：Runtime 只在一次 Provider Worker 调用前解析所需 `credentialRef`，通过私有 stdin 注入该次请求，调用结束即释放内存引用。
- `services/productionRuntimeClient.ts`：WebUI 图片提交、观察、取消全部使用 Runtime。
- `tools/flovart/cli.js`、`tools/flovart/mcp-server.js`：移除 local/shadow/browser 三分流。
- `vite.config.ts` 与 `tools/flovart/package.json`：移除文件 Bridge plugin 和发布文件。

### Provider Worker 约束

- 私有、版本化 JSONL stdio；Worker 不监听端口。
- 一次请求只获得该 Route 所需 Secret，不获得整个凭据列表。
- stdout 只写协议消息；诊断走脱敏 stderr。
- Runtime 持久化 `provider_attempts(created/submitting)` 后才启动外部网络提交。
- Provider 支持幂等 key 时必须转发；网络结果不确定且无 Provider 幂等保证时进入 `submission_unknown`，禁止自动重新提交。
- Provider URL 只能作为下载输入；Runtime 校验 MIME、大小、hash 并落 Artifact Store 后才宣告成功。
- 自动测试使用本地 Mock Server；真实付费 smoke 不进入默认 test/build。

### RED 测试

1. Worker request/response schema、超时、非零退出、畸形 stdout、超大响应都映射为稳定 Runtime error。
2. stdout、stderr、Runtime event、SQLite 和 Artifact metadata 都没有 API Key、Authorization 或签名 URL。
3. 模拟连接在提交前、提交后无响应、拿到 external job id 后中断三种故障，分别得到安全的恢复状态。
4. 真实 Route adapter 的 contract test 验证参数映射、鉴权 header、错误映射和结果下载，不产生付费请求。
5. Desktop WebUI 关闭后，图片任务继续；Runtime 重启后恢复轮询或得到 `ACTION_REQUIRED`。
6. CLI、MCP、WebUI 都不能再触达 `window.__flovartAPI`、CDP、`.flovart/command-queue.json` 或 `BridgeQueue`。
7. 已切换图片命令发生 Runtime unavailable 时直接失败，不回退浏览器。

### 必删文件与代码

以下删除与图片 hard cutover 放在同一批，不能留双权威：

- `tools/flovart/flovart-bridge.js`
- `tools/flovart/browser-commands.js`
- `tools/flovart/shadow-runtime.js` 中承担生产状态/执行的部分；若仍有纯本地偏好数据，迁入明确的 config store 后再删除整个文件。
- `src-tauri/src/bridge.rs`
- `tools/flovart/runtime-client.js` 中全部 CDP 实现
- `src-tauri/src/http.rs` 中固定 `7421`、无鉴权和 Secret GET 路由
- `src-tauri/src/bin/host.rs` 中固定 `EXE_HOST`
- `tests/shadowRuntime.test.ts`、旧 file-bridge 测试；由 Runtime ledger/recovery 测试替代，不是简单删除覆盖率。

### 视频过渡边界

已确认采用**严格单权威**：S1.3 图片 hard cutover 时，同步停用 WebUI 旧视频直连执行；CLI/MCP 的 `generate.video`、`video.status` 也不得回退到浏览器 Bridge，统一明确返回 `CAPABILITY_UNAVAILABLE`。视频能力在 S2 以 Runtime 持久任务方式恢复。

因此 S1.3 不允许保留 legacy、non-resumable 视频执行开关，也不允许用“临时 fallback”继续调用浏览器 Provider。这个选择会产生一个明确的视频功能空档，但能保证 Desktop Runtime 始终是唯一 Production Authority。

### 验收

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
npm test
npm run build
npm run flovart:cli -- command.list --json
npm run flovart:cli -- generate.image --prompt "runtime image contract smoke" --json
```

真实付费 smoke 只在用户确认后单独运行，并只提交一次低成本图片请求。

## S0/S1 总体验收定义

只有以下条件全部满足，S1 才能从“实施中”移动到 `pending-test.mdx`：

1. Desktop Runtime 是图片生产的唯一 authority，浏览器关闭不影响已接收任务。
2. Receipt、Task、Attempt、Artifact 与 Event 在 Runtime 重启后可查询和恢复。
3. CLI、MCP、WebUI 共享 registry、error code、task state 与事件语义。
4. Provider Secret 只存在 Keyring 和单次 Worker 内存；所有外部状态只出现 `credentialRef`。
5. 图片结果先进入内容寻址 Artifact Store，再以 revision op 投影到 Workflow。
6. 幂等冲突、revision 冲突、取消、lease 过期与 `submission_unknown` 都有自动化测试。
7. `cargo test`、`npm test`、`npm run build` 全部通过。
8. `todo.mdx`、`pending-test.mdx` 与 `CHANGELOG.md` 按实际实现状态更新；规划文档不得冒充已实现功能。

## 明确不在 S0/S1 做

- VOX Skill 安装、市场审核或运行。
- `ProductionSpecExtension.vox` 的实际 stage expansion。
- 视频、音频、TTS、音乐、FFmpeg 渲染与成片验证。
- Local Verified Route 的用户自定义 declarative mapping UI；S1 只验证一个第一方支持的图片 Adapter Family。
- 预算、Route Plan、Director Gate、Agent Intervention 的完整持久层；这些按数据契约进入 S2/S3。
- 云端 Hub、远程队列、跨设备同步、团队 RBAC。
