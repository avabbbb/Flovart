# Production Runtime 数据契约

## 状态与范围

本文把 [Production Runtime V1 实施规划](production-runtime-v1-plan.md) 压成可实现的数据边界，先服务 S0 安全 Control Plane、S1 持久图片任务和随后 15 秒 VOX 垂直切片。它不是已实现功能，也不要求一次创建全部后期表。

固定边界：

- Desktop Runtime 是唯一 Production Authority。
- ProductionSpec Revision 是制作计划权威；Workflow 只保存可重建投影和独立布局。
- Production Skill 只声明 ProductionSpec、Capability Requirement 与制作 Gate，不持有 Provider Secret、Route 或任意执行脚本权。
- Provider Secret 只存在操作系统凭据库；SQLite 只保存不可反查秘密的 `credential_ref`。
- 所有金额使用整数微单位和明确 `unit_code`，所有时间使用 UTC 毫秒，所有 ID 使用成熟 UUID v7 库生成并作为不透明 TEXT 返回。
- JSON 列只保存有版本 Schema 的封闭对象；可筛选、关联、唯一约束或参与状态机的字段必须独立成列。

## 权威数据分组

### S0/S1 必建表

| 表 | 关键字段 | 约束与责任 |
| --- | --- | --- |
| `command_receipts` | `command_id`、`actor_kind`、`actor_instance_id`、`idempotency_key`、`command_name`、`payload_hash`、`task_id`、`result_json` | `command_id` 唯一；`(actor_kind, actor_instance_id, idempotency_key)` 唯一。同 key 不同 payload 返回 `IDEMPOTENCY_CONFLICT`。 |
| `runtime_tasks` | `id`、`command_id`、`kind`、`status`、`entity_type`、`entity_id`、`progress_json`、`lease_owner`、`lease_expires_at`、`cancel_requested_at`、`result_json`、`error_json` | 长任务 State Projection；receipt 与 task 必须在任何外部副作用前同事务提交。 |
| `runtime_events` | `event_id`、`event_version`、`entity_type`、`entity_id`、`task_id`、`event_type`、`payload_json`、`created_at` | `event_id INTEGER PRIMARY KEY AUTOINCREMENT`；只追加，用于审计和 SSE 续传，不作为唯一查询模型。 |
| `production_sessions` | `id`、`project_id`、`title`、`brief_json`、`review_policy`、`primary_skill_snapshot_id`、`active_spec_revision_id`、`active_agent_binding_id`、`status` | 一部作品的上下文边界；V1 只允许一个 Primary Director Binding。 |
| `production_spec_revisions` | `id`、`session_id`、`revision_no`、`parent_revision_id`、`skill_snapshot_id`、`schema_version`、`core_json`、`extension_json`、`spec_hash`、`created_by`、`created_at` | `(session_id, revision_no)` 与 `spec_hash` 唯一；Revision 内容只插入不更新，批准记录进入 Gate 决策。 |
| `production_runs` | `id`、`session_id`、`spec_revision_id`、`route_plan_id`、`review_policy`、`status`、`started_at`、`finished_at` | 一次 Spec 的实际运行；Route Plan 确认前保持 `preparing`。 |
| `stage_runs` | `id`、`run_id`、`stage_key`、`capability_id`、`spec_path`、`status`、`input_hash`、`blocked_reason_json`、`started_at`、`finished_at` | `(run_id, stage_key)` 唯一；语义性变更创建新 Spec/Run 或 Replan，不覆盖旧阶段。 |
| `stage_dependencies` | `stage_run_id`、`depends_on_stage_run_id`、`dependency_kind` | 复合主键；Runtime 只把依赖全部满足的阶段转为 `ready`。 |
| `provider_attempts` | `id`、`stage_run_id`、`attempt_no`、`route_plan_entry_id`、`request_hash`、`provider_id`、`route_id`、`route_schema_hash`、`status`、`external_job_id`、`submitted_at`、`last_polled_at`、`error_json` | `(stage_run_id, attempt_no)` 唯一；提交后 Route 快照不变；`submission_unknown` 禁止自动新建 Attempt。 |
| `artifacts` | `id`、`sha256`、`kind`、`mime_type`、`byte_size`、`width`、`height`、`duration_ms`、`store_relpath`、`integrity_status`、`created_at` | `sha256` 唯一；Provider URL、Blob URL 和 Workflow node 不是长期真相源。 |
| `artifact_relations` | `artifact_id`、`related_artifact_id`、`role`、`ordinal` | 记录参考图、源视频、音轨、父版本等输入关系。 |
| `artifact_provenance` | `artifact_id`、`spec_revision_id`、`run_id`、`stage_run_id`、`provider_attempt_id`、`capability_id`、`product_model_id`、`prompt_hash`、`request_hash` | `artifact_id` 唯一；生成、导入、渲染和验证产物都必须说明来源。 |

### S1 Workflow 投影表

| 表 | 关键字段 | 约束与责任 |
| --- | --- | --- |
| `workflow_projects` | `id`、`title`、`active_session_id`、`created_at`、`updated_at` | 只保存工作区身份和当前 ProductionSession，不再把一份任意 graph JSON 当制作计划权威。 |
| `workflow_plan_projections` | `id`、`project_id`、`session_id`、`spec_revision_id`、`run_id`、`projection_version`、`projection_json`、`projection_hash` | 从 Spec/Run 派生的可删除缓存；同一输入必须得到相同 hash。 |
| `workflow_layouts` | `project_id`、`session_id`、`layout_revision`、`layout_json`、`viewport_json`、`updated_at` | 节点位置、折叠和视口独立 CAS；纯布局修改不产生新 Spec。 |

计划字段编辑不直接更新投影。`production.spec.patch` 必须携带父 `spec_revision_id`，校验后创建新 Revision，再重新投影受影响节点；`workflow.layout.update` 只携带 `expected_layout_revision`。

### S2/S3 路由、审批与预算表

| 表 | 关键字段 | 约束与责任 |
| --- | --- | --- |
| `provider_credentials` | `id`、`provider_id`、`label`、`keyring_ref`、`status`、`last_verified_at` | 只保存 Keyring metadata；任何 API 都不能返回 Secret。 |
| `local_verified_routes` | `id`、`provider_id`、`adapter_family`、`credential_ref`、`base_url`、`route_id`、`schema_version`、`schema_json`、`schema_hash`、`contract_status`、`smoke_status`、`status` | 只允许已支持 Adapter Family；Contract Test 通过并确认后才能执行。 |
| `product_route_bindings` | `id`、`product_model_id`、`generation_mode`、`route_id`、`priority`、`enabled` | 用户长期偏好，不等于单次运行的锁定线路。 |
| `run_route_plans` | `id`、`run_id`、`revision_no`、`status`、`plan_hash`、`estimated_amount_micros`、`unit_code`、`confirmed_at` | `proposed -> confirmed|rejected`；ProviderAttempt 创建后不可改写已确认版本。 |
| `run_route_plan_entries` | `id`、`plan_id`、`stage_key`、`capability_id`、`product_model_id`、`generation_mode`、`provider_id`、`route_id`、`route_schema_hash`、`credential_ref`、`quote_json`、`selection_reason` | `(plan_id, stage_key)` 唯一；Production Skill 不得填这些字段。 |
| `production_gates` | `id`、`run_id`、`stage_run_id`、`gate_kind`、`gate_type`、`status`、`request_json`、`created_at`、`resolved_at` | `system|director|user`；System Gate 不能被 Review Policy 跳过。 |
| `gate_decisions` | `id`、`gate_id`、`decision`、`actor_kind`、`actor_id`、`reason`、`created_at` | 决策只追加；当前 Gate 状态与决策同事务更新。 |
| `run_budgets` | `run_id`、`hard_limit_micros`、`retry_reserve_micros`、`unit_code`、`status` | 一次 Run 一个已批准预算边界。 |
| `cost_reservations` | `id`、`run_id`、`stage_run_id`、`provider_attempt_id`、`amount_micros`、`unit_code`、`status`、`quote_source` | Provider 提交前创建；Submission Unknown 保持占用。 |
| `usage_ledger` | `entry_id`、`run_id`、`reservation_id`、`provider_attempt_id`、`entry_type`、`amount_micros`、`unit_code`、`source_json`、`created_at` | 不可变流水；`reserve|confirm|release|refund|adjust`，不使用浮点金额。 |

### Agent 绑定与介入表

| 表 | 关键字段 | 约束与责任 |
| --- | --- | --- |
| `agent_session_bindings` | `id`、`production_session_id`、`host_type`、`external_session_id`、`protocol_version`、`status`、`created_at`、`archived_at` | 一个 Session 同时最多一个 `active` Binding；不保存 Agent Key 或原始对话。 |
| `agent_handoff_snapshots` | `id`、`production_session_id`、`spec_revision_id`、`snapshot_json`、`snapshot_hash`、`created_at` | Runtime 从权威状态生成，不包含隐藏推理和 Secret。 |
| `agent_interventions` | `id`、`run_id`、`stage_run_id`、`event_id`、`reason_code`、`snapshot_id`、`status`、`dispatched_binding_id`、`created_at`、`resolved_at` | `pending -> dispatched -> resolved|dismissed`；普通进度事件不创建介入。 |

## 状态与事务规则

### 封闭状态

- RuntimeTask：`queued | working | input_required | completed | failed | cancelled`
- ProductionRun：`preparing | action_required | queued | running | recovering | canceling | completed | completed_with_warnings | failed | canceled`
- StageRun：`pending | ready | running | blocked | succeeded | failed | skipped | canceled`
- ProviderAttempt：`created | submitting | submitted | polling | succeeded | failed | canceled | submission_unknown`

状态转换由 Runtime service 校验并用 SQLite `CHECK` 约束合法值，不使用数据库 Trigger 隐藏业务流程。

### 必须原子的事务

1. 接受写命令：`command_receipts + runtime_tasks + 首个实体投影 + runtime_events`。
2. 开始付费提交：`provider_attempts(created/submitting) + cost_reservations + usage_ledger(reserve) + runtime_events`。
3. 收到 Provider 接单：`provider_attempts(submitted + external_job_id) + runtime_events`。
4. 生成成功：`provider_attempts + artifacts + artifact_relations + artifact_provenance + stage_runs + usage_ledger + runtime_events`；需要更新画布时在同事务写新 Projection 引用。
5. 审批：`gate_decisions + production_gates + production_runs/stage_runs + runtime_events`。

文件 Blob 采用同目录临时文件写入、`fsync`、内容 hash 校验和原子 rename；数据库事务只提交最终 `store_relpath`。Runtime 启动时回收未被数据库引用的临时文件，不删除仍被 Spec、Run、Lock 或 Artifact relation 引用的 Blob。

## Runtime Control API

Local HTTP、Tauri IPC、CLI 与 MCP 只适配同一个 `ProductionRuntime` Interface：

```text
POST /v1/commands              submit(CommandEnvelope)
GET  /v1/tasks/{taskId}        getTask
GET  /v1/tasks                 listTasks(cursor, filter)
POST /v1/tasks/{taskId}:cancel cancelTask
GET  /v1/tasks/{taskId}/result getTaskResult
GET  /v1/events                streamEvents(Last-Event-ID)
```

除最小 handshake/health 外，Local HTTP 全部要求启动期 Bearer Token。MCP Tasks 仍是实验能力，只作为未来 Adapter；Runtime Task ID 和状态机不依赖 MCP。

### CommandEnvelope v1

```json
{
  "protocolVersion": "1",
  "commandId": "cmd_uuidv7",
  "command": "capability.submit",
  "args": {},
  "actor": { "kind": "cli", "instanceId": "cli_uuidv7" },
  "idempotencyKey": "stable-key-from-caller",
  "productionSessionId": "ps_uuidv7",
  "preconditions": [
    { "entityType": "production_spec", "entityId": "spec_uuidv7", "revision": 3 }
  ]
}
```

规则：

- 所有写命令必须有 `idempotencyKey`；读取命令不得制造 receipt。
- `payload_hash` 使用成熟 RFC 8785 JSON canonicalization 实现后再做 SHA-256，不自行拼字符串。
- `args` 由 Canonical Registry 的封闭 JSON Schema 校验；未知字段拒绝，不静默忽略。
- `preconditions` 只用于可变投影；不可变 Spec 通过明确 `parentRevisionId` 建新版本。

### TaskReceipt v1

```json
{
  "kind": "task",
  "commandId": "cmd_uuidv7",
  "taskId": "task_uuidv7",
  "status": "queued",
  "entity": { "type": "stage_run", "id": "stage_uuidv7" },
  "pollIntervalMs": 1000,
  "eventId": 102,
  "links": {
    "task": "/v1/tasks/task_uuidv7",
    "events": "/v1/events?taskId=task_uuidv7"
  }
}
```

### RuntimeEvent v1

```json
{
  "eventId": 145,
  "eventVersion": "1",
  "eventType": "stage.action_required",
  "entity": { "type": "stage_run", "id": "stage_uuidv7" },
  "taskId": "task_uuidv7",
  "productionRunId": "run_uuidv7",
  "occurredAt": 1780000000000,
  "data": {
    "reasonCode": "PROVIDER_SUBMISSION_UNKNOWN",
    "actionUrl": "flovart://production/run_uuidv7/stage/stage_uuidv7"
  }
}
```

事件 payload 只包含脱敏状态和 Artifact ID；不包含 Prompt 全文、Provider Request Body、签名 URL、Authorization 或 Secret。

### 稳定错误码

`INVALID_ARGUMENT`、`UNKNOWN_COMMAND`、`IDEMPOTENCY_CONFLICT`、`PRECONDITION_FAILED`、`PROTOCOL_MISMATCH`、`RUNTIME_UNAVAILABLE`、`PERMISSION_DENIED`、`ROUTE_UNAVAILABLE`、`ROUTE_SCHEMA_INVALID`、`BUDGET_EXCEEDED`、`ACTION_REQUIRED`、`PROVIDER_SUBMISSION_UNKNOWN`、`TASK_NOT_FOUND`。

错误对象统一为：

```json
{
  "code": "PRECONDITION_FAILED",
  "message": "Workflow layout revision is stale.",
  "retryable": false,
  "details": { "expected": 12, "actual": 14 },
  "actionUrl": null
}
```

`message` 用于人读，Agent 只根据 `code`、`retryable`、`details` 和 `actionUrl` 决策。

## Canonical Command Registry v1

### S0/S1 首批命令

| 命令 | 模式 | 作用 |
| --- | --- | --- |
| `runtime.status` | sync/read | 协议、Runtime 与恢复状态，不返回 Secret。 |
| `command.list` / `command.schema` | sync/read | 从同一 registry 返回命令与 JSON Schema。 |
| `capability.submit` | task/write | Provider-neutral 原子能力提交；首个实现只开放 `image.generate`。 |
| `task.get` / `task.list` / `task.result` | sync/read | 查询统一 Runtime Task。 |
| `task.cancel` | sync/write | 请求协作式取消，不虚报 Provider 已取消。 |
| `task.watch` | stream/read | CLI 对 Runtime Event Stream 的展示适配。 |
| `artifact.get` / `artifact.list` | sync/read | 返回 metadata、provenance 与受控本地打开动作。 |
| `workflow.layout.update` | sync/write | 只更新布局与视口 revision。 |

### S3/S4 Production Intent

| 命令 | 模式 | 作用 |
| --- | --- | --- |
| `production.session.create` | sync/write | 创建 ProductionSession 并锁定 Primary Director Snapshot。 |
| `production.spec.create-revision` | sync/write | 校验 Core + Extension 并插入不可变 Revision。 |
| `production.dry-run` | task/read | 编译 Stage DAG、能力缺口、Gate、Run Route Plan 与费用，不提交 Provider。 |
| `production.run` | task/write | 以已批准 Spec、Run Route Plan 和 Run Budget 启动执行。 |
| `production.status` / `production.watch` | read/stream | 返回 Run、Stage、Gate、费用与 Artifact 摘要。 |
| `production.approve` | sync/write | 只提交类型化 Production Gate Decision。 |
| `production.retry-stage` | task/write | 只为可重试阶段创建新 Attempt；Submission Unknown 必须先人工对账。 |
| `production.replan` | sync/write | 创建 Replan Request，不直接修改运行中 Spec。 |
| `route.plan.preview` / `route.plan.confirm` | read/write | Runtime 提案并由用户锁定 Run Route Plan。 |

`generate.image`、`generate.video` 与 `workflow.node.run` 保留为 Production Intent Command，由 Runtime 展开到上述原子契约；`video.status` 最终成为 `task.get` 的只读别名，不保留第二套状态机。

## ProductionSpec Core v1

Core 只表达作品意图，不包含 Provider、endpoint、credentialRef 或模型 ID：

```json
{
  "schemaVersion": "flovart.production-spec/1",
  "specId": "spec_uuidv7",
  "productionSessionId": "ps_uuidv7",
  "revision": 1,
  "parentRevisionId": null,
  "brief": {
    "topic": "货币如何改变世界",
    "objective": "15秒竖屏拼贴讲解片",
    "audience": "短视频用户",
    "language": "zh-CN"
  },
  "delivery": {
    "durationMs": 15000,
    "aspectRatio": "9:16",
    "container": "mp4",
    "videoCodec": "h264",
    "audioCodec": "aac",
    "captions": "burned-in"
  },
  "narrative": {
    "arc": "timeline",
    "beats": [
      {
        "id": "beat-1",
        "order": 1,
        "narration": "……",
        "shots": [
          {
            "id": "shot-1a",
            "order": 1,
            "durationMs": 2500,
            "scene": "……",
            "title": "交换之前",
            "capabilityRequirements": [
              { "capability": "image.generate", "features": ["text-rendering", "reference-image"] },
              { "capability": "video.generate", "features": ["image-to-video"] }
            ]
          }
        ]
      }
    ]
  },
  "audio": {
    "narration": { "language": "zh-CN", "voiceProfile": "documentary" },
    "music": { "intent": "rhythmic editorial instrumental", "duckUnderNarration": true }
  },
  "gates": [
    { "id": "approve-spec", "kind": "director", "type": "spec" },
    { "id": "approve-style", "kind": "director", "type": "style-bakeoff" }
  ],
  "extensions": {}
}
```

Runtime Compiler 从 Core 生成平台标准 Stage：`style.preview`、`image.generate`、`video.generate`、`speech.generate`、`music.generate`、`media.render`、`media.verify`。Production Skill 可以省略不需要的能力或配置标准 Gate，但不能注册私有 Stage type。

## VOX Skill Extension v1

VOX 迁移只把风格专属信息放入 `extensions.vox-director`，不复制 Core 的 narration、shot、duration 或能力字段：

```json
{
  "extensions": {
    "vox-director": {
      "schemaVersion": "1",
      "themeCandidates": ["american-retro", "swiss-modern", "punk-zine"],
      "selectedTheme": null,
      "look": {
        "idiom": "paper-collage",
        "palette": ["ochre", "deep-red", "ink-black"],
        "typeStyle": "cut-out-headline",
        "finish": ["torn-edge", "halftone", "newsprint", "tape"],
        "motionStyle": "punchy",
        "constraints": "strict"
      },
      "shotDirectives": {
        "shot-1a": {
          "shotSize": "WIDE",
          "cameraMove": "push_in",
          "elementMotion": "纸片人物滑入，硬币散落，半调网点脉动",
          "headlineLocked": true
        }
      }
    }
  }
}
```

迁移规则：

- VOX 的叙事弧、Prompt 结构、主题预设、镜头节奏和质量规则进入 Skill references/assets/Extension Schema。
- `atlas_cloud.py`、模型 ID、环境变量、下载、轮询、自动重提和 ffmpeg 调用不得进入公开 Package 执行路径。
- Prompt 组合等纯 JSON/Text 转换可以成为无网络、无秘密、声明输入输出的 Deterministic Skill Script。
- 元素级本地动画只有先成为带资源上限、固定输入输出和取消语义的 `media.animate-layers` Runtime Capability 后才能执行。

## 15 秒 VOX 放行样例

固定为约 3 个 beat、6 个 shot，并使用 Balanced Review Policy：

1. Flovart Agent + VOX Skill 生成 Spec Revision。
2. Director Gate：确认分镜。
3. `style.preview` 产生 3–4 张样图 Artifact；Director Gate：确认风格。
4. Runtime 生成多 Provider Run Route Plan 和 Route Price Quote；System Gate：确认 BYOK 路由与 Run Budget。
5. 6 个 `image.generate` Stage 可在预算并发上限内并行。
6. 6 个 `video.generate` Stage 依赖各自关键帧；ProviderAttempt 各自独立恢复。
7. `speech.generate` 与 `music.generate` 可和视频并行，结果全部物化为 Artifact。
8. `media.render` 使用 Runtime 受控 ffmpeg 能力合成字幕、旁白、ducking 和最终 MP4。
9. `media.verify` 至少验证容器、视频/音频流、时长容差、分辨率、可解码性、黑帧和异常静音，输出 JSON 报告 Artifact。
10. 只有创意失败、Action Required 或审片门创建 Agent Intervention；普通进度由 Runtime/TUI 展示。

放行条件：关闭 WebUI、断开 CLI 或重启 Runtime 后，同一 ProductionRun 可以仅凭 ID 恢复；任何 Stage 不因观察端断线而重复提交；最终 MP4、验证报告、全部输入和费用都能追溯到 Spec Revision、Route Plan、StageRun 与 ProviderAttempt。

## 索引与保留策略

必须建立的主要索引：

- `runtime_tasks(status, updated_at)`
- `runtime_events(task_id, event_id)` 与 `(entity_type, entity_id, event_id)`
- `production_spec_revisions(session_id, revision_no DESC)`
- `production_runs(session_id, created_at DESC)`
- `stage_runs(run_id, status)`
- `provider_attempts(stage_run_id, attempt_no DESC)` 与 `(provider_id, external_job_id)`
- `artifacts(sha256)`
- `production_gates(run_id, status)`
- `usage_ledger(run_id, entry_id)`
- `agent_interventions(status, created_at)`

V1 不写旧字段兼容和浏览器数据静默迁移。旧 `sync_log`、shadow state 和 file bridge 仅在切换批次中短暂共存，调用方全部转到 ProductionRuntime 后直接删除；用户需要保留的旧项目只能走显式导出/导入决策。
