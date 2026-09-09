# Flovart Link 2.0 + Studio Host Platform 进度

本表只记录当前工作树证据；`implemented` 不等于第三方宿主认证，`External
Gate` 不等于 mock 已通过真实验收。

## Phase 0 — Audit

状态：`implemented`

- 已记录 dirty worktree、HEAD、Vitest/typecheck/build/extension/DSH/Rust/browser
  基线。
- 已读取真实启动、bootstrap、Browser writer、dispatcher、Executor、resource
  resolver、CLI/Skill、Host discovery/projection、DSH 和用户可见 UI。
- 已生成 `CURRENT_STATE.md`、`TARGET_STATE.md`、`STATE_MACHINE.md`、
  `HOST_MATRIX.md`，并记录 DSH Browser-only 边界与剩余外部门禁。

## Phase 1 — Flovart Link Core

状态：`implemented / focused-tested`

- `services/link/` 提供声明式 Host Definition、registry、默认 discovery/prepare/
  activate lifecycle、四态 public status 和 `ensureHostReady`。
- `tools/flovart/ensure.js` 复用现有 status/start/coordinator，不创建第二 Runtime。
- Agent picker 普通路径只显示 Codex、WorkBuddy、DeepSeek Harness 与用户动作；
  技术信息留在 Developer Diagnostics。
- 通过 Link/host/status/UI focused tests；没有将 `/dock` 的开发者表面冒充普通入口。

## Phase 2 — Workspace Lease

状态：`implemented / focused-tested`

- `agent/workspace-lease.js` 支持 acquire、validate、renew、release、expire，
  固定 `leaseId/agentIdentity/clientId/projectId/baseRevision/issuedAt/expiresAt`。
- inspect/selection/apply/node.run 共享 Agent turn lease；mutation 校验 revision、
  mutationId 和固定目标；Tab close 会 revoke client lease。
- 跨 project、跨 client、过期、revision conflict、Browser close 和重复 mutation
  有 focused tests；完整 20x chaos 尚未执行。

## Phase 3 — Codex / WorkBuddy / DSH

### Codex

状态：`implemented / closest-possible-tested`

- Skill 已收敛到 `ensure/status/inspect/selection/apply/run`，不读取 token、port、
  `agent.json`，不实现 SSE/browser binding。
- bootstrap 默认走 issue → exchange → session credential，地址栏 scrub；Chrome
  for Testing smoke 证明动态端口、Browser connection 和 Workflow presence。
- 真实 Codex 登录 conversation 是 `EXTERNAL_CODEX_CERTIFICATION`。

### WorkBuddy

状态：`artifact-validated / external-client-gated`

- 生成 official-shape `connector-meta.json`、`cli.json`、icon 和 Skill/reference，
  `workbuddy.status/auth/unAuth` 采用 local-ready semantics，不伪造 OAuth。
- package validation、secret/plumbing checks、clean install fixture 通过；真实
  WorkBuddy client/Marketplace/natural-language tracer 未运行。

### DeepSeek Harness

状态：`service-and-profile-validated / real-session-gated`

- `@flovart/dsh-plugin` 提供 Cordis `ctx.flovart`：status、workspace inspect/
  selection、workflow apply/run、artifact get；只投影五个稳定工具。
- 真实 RC8 packed profile install 与 `dsh --profile flovart --dump-config` 通过。
- Cordis service unload/reload 已由临时 CLI 的真实进程切换 contract test 覆盖；
  profile 内真实登录 conversation、Browser Workflow tracer 和发布升级回滚仍是
  External Gate。DSH 不再维护第二份 Native Workflow authority。

## Phase 4 — Studio Resource Contract

状态：`implemented / contract-tested`

- Creative Host selection 进入 `WorkflowResourceReference` 的 `creative-host`
  locator，再由已有 `ExecutableResourceResolver`/`CanonicalGenerationInput` 处理。
- `services/studio/studioContract.ts`、`studioClient.ts`、`studioWorkflow.ts` 只调用
  stable inspect/apply/node.run/artifact contract，不包含 Provider 或 Host-specific
  generation input。
- generate 前后均重新检查 document/selection，避免把结果导入新选择。

## Phase 5 — Studio packages

状态：`partial / external-host-gated`

- Photoshop UXP manifest v4、Premiere UXP manifest v5（25.6+）、After Effects CEP
  manifest 和 Resolve Studio Workflow Integration package 及共享 compact
  inspector 已实现；`npm run studio:build` 输出四类 `dist-studio/` 包。
- 四类宿主都只等待 Link 注入，不直连 Provider、不拿 credential；selection、
  materialization、artifact import 都走 provider-neutral resource contract。
- 真实 Photoshop：`EXTERNAL_GATE`，见 `PHOTOSHOP_REAL_HOST_CHECKLIST.md`。
- 真实 Premiere：`EXTERNAL_GATE`，见 `PREMIERE_REAL_HOST_CHECKLIST.md`。
- 真实 After Effects CEP/ExtendScript：`EXTERNAL_GATE`，见
  `AFTER_EFFECTS_REAL_HOST_CHECKLIST.md`。
- 真实 Resolve Studio Workflow Integration：`EXTERNAL_GATE`，见
  `RESOLVE_REAL_HOST_CHECKLIST.md`；不宣称 free Resolve native Inspector。

## Phase 6 — Regression / security / performance

状态：`partial`

- Link/Lease/Studio/WorkBuddy/DSH focused tests 通过；最新全量 Vitest 为 169 个文件、
  1091 passed、1 skipped；typecheck、Web、extension、DSH build 和 diff check 通过。
- secure one-time bootstrap 的 Chrome for Testing smoke 已通过：空项目引导、Codex
  writer、WorkBuddy 不抢占、Skill 下载、CLI inspect、reload 恢复和 Workflow drawer
  均覆盖；真实宿主/登录会话和生产发布安全扫描仍未形成 Release DoD 证据。
- Provider I2I/I2V wire、Canvas manual matrix、20x chaos、warm/p95 benchmark、
  independent red-team P0/P1 review 尚未形成本轮完整证据。

## External gates

- Codex authenticated first conversation；
- WorkBuddy real client/Marketplace；
- DSH authenticated profile and service recovery；
- Photoshop/Premiere real host layer/clip tracer；
- AE/Resolve host availability and current official API route；
- real paid Provider, billing/cancel semantics and release-hosted security scans。

## Next action

在最终候选上复跑全量 regression，再在可用的真实宿主环境运行 checklist；在此之前
Support Matrix 只允许 Experimental/Planned，不能将本目标标记为完成。
