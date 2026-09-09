# Flovart Link 2.0：状态机

## Public Link 状态

```text
                    ┌──────────────┐
        detect ───▶ │ needs_setup  │ ──prepare/安装──┐
                    └──────────────┘                 │
                                                     ▼
┌─────────┐  ensure/start  ┌──────────────┐  login  ┌──────────────┐
│ offline │ ─────────────▶ │ needs_login  │ ─────▶  │    ready     │
└─────────┘ ◀───────────── └──────────────┘         └──────────────┘
      ▲          service/host failure                       │
      └──────────────────────────────────── recovery ◀───────┘
```

`needs_setup` 表示未安装/未准备 Host；`needs_login` 只表示 Host 自己报告需要登录；`offline` 表示 Flovart 本地服务、Browser Workspace 或必要连接不可用。HTTP/SSE/token/clientId 等只进入 diagnostics，不直接成为 public state。

## Browser bootstrap credential

```text
launcher Agent credential
  └─ POST /bootstrap/issue ─▶ one-time bootstrap credential
                                  └─ URL handoff
                                      └─ POST /bootstrap/exchange
                                          ├─ session credential → authenticate → ready
                                          └─ invalid/expired → auth_failed → public needs_login/offline
```

交换完成后立即 scrub URL；session credential 有 expiry，bootstrap credential 不能
重复使用。旧 `agentToken` 只保留兼容读取，不是新的正常入口。

## Link lifecycle

```text
idle
  └─ ensure ─▶ detecting
                  ├─ host missing ─▶ needs_setup
                  ├─ host login missing ─▶ needs_login
                  ├─ local service down ─▶ offline
                  └─ ready candidate ─▶ preparing
                                      ├─ prepare failed ─▶ offline/needs_setup
                                      └─ prepared ─▶ activating
                                                     ├─ browser missing ─▶ offline
                                                     ├─ target changed ─▶ offline + safe recovery
                                                     └─ active ─▶ ready
```

`ready` 会话内不重复 PATH scan、全量 host version probe、projection reinstall 或 Browser open。health recovery 只检查已选 Host/已知 workspace；cold bootstrap 才执行完整 detect/prepare。

## Workspace Lease lifecycle

```text
none
  └─ acquire(agent, client, project, revision) ─▶ active
                                                    │
                 ┌──────────── renew ─────────────┘
                 │
                 ├─ validate(inspect/apply/run) ─▶ active
                 ├─ release ─────────────────────▶ released
                 ├─ expiresAt reached ───────────▶ expired
                 ├─ client/project changed ──────▶ target_changed
                 └─ Browser close/service loss ───▶ unavailable
```

状态与错误映射：

| 条件 | 结果 |
| --- | --- |
| lease 不存在或过期 | `LEASE_EXPIRED` |
| 请求 project 与 lease project 不同 | `LEASE_TARGET_CHANGED` |
| writer/client 不再可用 | `WORKSPACE_UNAVAILABLE` |
| expectedRevision 不等于当前项目 revision | `REVISION_CONFLICT` |
| 同 mutationId、同目标重试 | 原 receipt，不能重复 mutation |
| 同 mutationId、不同目标或 payload | `IDEMPOTENCY_CONFLICT` |

## Browser writer 事件

```text
browser connected
  └─ snapshot published ─▶ candidate writer
                              ├─ no active writer ─▶ active writer
                              └─ other active writer ─▶ visible but non-authoritative

active writer
  ├─ explicit activate same project ─▶ active writer
  ├─ project changes ─▶ old lease target_changed; new lease requires explicit acquire
  ├─ Tab closes ─▶ unavailable; pending calls fail
  └─ reconnect ─▶ new connection/candidate; old lease never自动迁移到新 project
```

## Studio run lifecycle

```text
selection idle
  └─ context update ─▶ selection materialized
                          └─ generate ─▶ resolving
                                         ├─ resource error ─▶ input error + retry
                                         ├─ unsupported mode ─▶ input error + change mode
                                         ├─ provider error/timeout ─▶ provider error + retry
                                         └─ artifact ready ─▶ importing
                                                            ├─ host closed/changed ─▶ import error; keep artifact
                                                            ├─ import failed ─▶ host import error; keep artifact
                                                            └─ imported as new object ─▶ done
```

Host selection/document identity 必须在 import 前重新验证；context 变化不能把结果写入新选择或新项目。

## DSH service lifecycle

```text
service available
  └─ ctx.inject(['flovart']) ─▶ service + derived tools ready
                                  ├─ service disappears ─▶ tools dispose safely
                                  └─ service returns ─────▶ fresh service/tools injection
```

派生工具的 disposer 由 Cordis 注入生命周期持有，不能缓存已经失效的 service
reference。DSH profile 固定使用 Browser Workflow；没有可见 Browser Workspace
时失败，不创建 Native Draft 或其他隐式 fallback。
