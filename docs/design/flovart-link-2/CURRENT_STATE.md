# Flovart Link 2.0：当前状态审计

本文记录当前工作树的真实调用边界和验证结果。它不是把 package build 或
mock contract 当成第三方宿主完成声明；工作树开始时已有用户修改，本轮没有
回滚这些修改。

## 审计入口与基线

已读取 `agent/`、`services/`、`stores/`、`components/agent/`、
`components/workflow/`、`tools/flovart/`、`dsh-plugin/`、Skill、测试、启动器
和 Studio/WorkBuddy integration source。

| 检查 | 当前证据 | 结论 |
| --- | --- | --- |
| HEAD | `df3984b99795d58543718876cd764a5be9ed7294` | 基线 SHA |
| 工作树 | Agent、Workflow、文档、Link、Studio、WorkBuddy 等有修改/新增 | 既有修改保留 |
| `npx tsc --noEmit` | 通过（Studio host package、Workflow lazy mount 补丁后复跑） | 无已知新增 TypeScript 错误 |
| `npm run build` | 通过 | Web production build 通过 |
| `npm run ext:build` | 通过 | Extension build 通过 |
| DSH build/typecheck | 通过 | `npm --prefix dsh-plugin run build` 与 DSH tsc 通过 |
| Link/Lease/Studio/WorkBuddy/DSH focused tests | 15 files / 68 tests 通过 | 契约边界通过 |
| 全量 Vitest | 169 files，1091 passed，1 skipped | 当前候选全量复跑通过 |
| Rust | `cargo test --manifest-path src-tauri/Cargo.toml`：所有 lib/bin/integration/doc tests 通过 | 当前 Rust targets 通过 |
| Chrome smoke | Chrome for Testing、动态 loopback、一次性 bootstrap exchange、clients=1、hasWorkflow=true；Agent/WorkBuddy/Workflow drawer 全链路通过 | 本机浏览器路径通过；真实登录/宿主仍是 External Gate |
| `git diff --check` | 通过 | 仅有换行风格提示 |

## Startup 与 bootstrap 调用图

```text
flovart ensure --json
  └─ getLocalStatus
      ├─ probe discovered WebUI
      ├─ inspect local Agent
      └─ not ready → startLocal(..., --source --web, --no-open)

flovart start --open
  └─ tools/flovart/dev-commands.js:startLocal
      ├─ spawn Vite WebUI（动态或指定 loopback 端口）
      ├─ ensureSourceAgent → spawn agent/index.js
      │   └─ launcher-only agent.json credential
      └─ FlovartBootstrapCoordinator
          ├─ wait for WebUI / Agent
          ├─ POST /bootstrap/issue（Agent token 只在本机进程请求头）
          ├─ build WebUI URL（agentUrl + one-time bootstrapToken）
          └─ openBrowser（仅 launcher 才带一次性 writer 标志）
```

Agent 与 WebUI 默认只绑定 `127.0.0.1`/允许的 loopback origin；不会为了宿主
插件监听 `0.0.0.0`。`agent.json` 仍是 CLI/launcher 的本地凭据文件，不是普通
用户需要查看或复制的产品设置。

### Credential 生命周期

1. launcher 用持久 Agent token 请求 `/bootstrap/issue`；服务签发短期、一次使用
   的 bootstrap credential。
2. 浏览器只收到带 `agentUrl` 与 `bootstrapToken` 的启动 URL。
3. `agentConnectionBootstrap` 在 loopback origin 调用 `/bootstrap/exchange`，换取
   session credential；交换成功后通过 `/health` 与 `/crew/protocol` 验证。
4. session credential 只保存在 `sessionStorage`，带过期时间；URL 中的
   `agentUrl`、bootstrap/token 参数和自动 writer 标志立即由 `history.replaceState`
   清理。普通 `localStorage` 不保存 Agent token。
5. 旧 `agentToken` URL 读取仍是兼容路径，不能作为新的产品入口或安全闭环证据。
   SSE 使用已交换的 session credential，不把 bootstrap credential 继续传递。

## Browser Workflow Authority

```text
WorkflowWorkspaceAdapter
  └─ WorkflowAgentBridge
      └─ browserWorkflowContract
          └─ workflowDispatcher / Draft Authority
              ├─ useWorkflowStore（可见 Workflow truth）
              └─ WorkflowExecutor → CanonicalGenerationInput → Provider Adapter
```

Browser 通过 `/workflow/state?clientId=...` 发布快照。`WorkflowAgentSession` 保存
每个连接的 snapshot，首个可见连接成为 active writer；第二个 Tab 只能发布非权威
快照，必须显式 activate 才能切换。active Tab 关闭会撤销 writer、清理 snapshot、
撤销其 lease 和 pending request；不会切到 `lastFocusedProject`、旧 Tab 或随机项目。

`WorkspaceLeaseManager` 目前是 Agent 进程内的 TTL registry（默认 120 秒），
按 `agentIdentity + hostSession/source` 复用同一 lease，固定 `clientId/projectId`，
在 inspect/selection/apply/run 前校验目标、revision 和 mutation id，并支持
acquire/validate/renew/release/expire。跨项目、跨 writer、关闭 Browser、过期和
revision 变化返回结构化错误。

### DSH Browser-only 边界

DSH profile 现在显式设置 `workspaceMode=browser`。`ctx.flovart`、派生工具和
`conversation.view` 都只通过 Host 同源代理调用 Flovart stable contract；它们
读取并操作可见 Browser Workflow，不创建 Native Draft、不保存第二份项目状态，
也不直接访问 React state 或 Provider。没有可见 Browser Workflow 时只返回
`WORKSPACE_REQUIRED`/`WORKSPACE_UNAVAILABLE`，不做隐藏 fallback。

## Agent Host 调用图

```text
Codex / Claude / OpenCode / Pi / CodeBuddy
  └─ Skill → flovart CLI → FlovartWorkspaceClient → /api/tools
      └─ WorkflowAgentSession → Browser SSE tool_call → dispatcher

WorkBuddy
  └─ official-shape Connector + Skill → WorkBuddy lifecycle / stable commands
      └─ ensure → same local Agent/Browser Workflow surface

DSH
  └─ @flovart/dsh-plugin Cordis Service (ctx.flovart)
      ├─ CLI/proxy → stable Flovart contract
      └─ contextual conversation.view → visible Browser Workflow summary
```

Link host definitions 已集中在 `services/link/hostDefinition.ts`、
`hostRegistry.ts` 和 `hostActivation.ts`；默认 lifecycle 复用 discovery、projection
prepare、Browser writer activation，不在每个 Host 复制 retry、JSON parsing 或
Workflow command。

## 用户可见表面分类

| 表面 | 分类 | 当前处理 |
| --- | --- | --- |
| `/app` Agent picker 的 Codex/WorkBuddy/DSH | Public | 只显示 `ready`、`needs_setup`、`needs_login`、`offline` 及用户动作 |
| URL、Token、Port、SSE、clientId、writer、Projection、Binding | Developer diagnostics | 仅内部状态/折叠诊断；不属于普通 onboarding |
| `/dock` 连接、Director、Bridge 细节 | Developer surface | 保留诊断价值，不能作为普通 Workflow 入口 |
| `ensure/status/workflow.inspect/selection/apply/node.run` | Stable Agent surface | Skill/Connector/DSH 复用，不向普通用户展示内部 plumbing |
| Studio compact inspector | Public host UI | 选择 → reference → Prompt → Generate → host import |

`ProductionCrewPanel`、`AgentWorkspace` 和 Workflow 右栏的旧“连接 Agent/Host
Projection/连接指令”文案已收敛为协作状态；`/dock` 内部表单仍是开发者诊断，不能
冒充 Zero-config 用户路径。

## 当前实现与目标的差距

- Link lifecycle、public status、`ensure`、一次性 bootstrap 和 Workspace Lease
  已有实现及 focused tests，但 lease 尚未持久化，也没有 20 次 chaos 的完整证据。
- WorkBuddy official-shape connector artifact 已生成并通过结构/clean fixture
  检查；真实 WorkBuddy client/Marketplace 安装和自然语言会话仍是 External Gate。
- DSH `ctx.flovart`、五个稳定工具和 RC8 profile install/`--dump-config` 已通过；
  Cordis service unload/reload 已有临时 CLI 进程的 contract test，但真实登录会话、
  真实 Harness 页面 tracer 和发布升级回滚仍未认证。
- Photoshop/Premiere/After Effects/Resolve Studio 共享 `CreativeHostAdapter`、资源契约、
  面板 package 和 contract/mock fixture 已实现；面板仍等待 Link 注入
  materialize/import/controller，本机没有真实宿主 transcript，不能标 Stable。
- AE 有 CEP package，Resolve Studio 有 Workflow Integration package；两者的 bridge、
  安装和真实 tracer 仍未认证，状态为 Experimental。
- Provider I2I/I2V 的既有 wire regression 仍需在最终候选上复跑；Studio contract
  本身不能代替真实 Provider credential 或 host import 证据。
- 最新全量 Vitest 为 169 个文件、1091 passed、1 skipped；Rust、TypeScript、Web、
  extension、DSH、Studio package build 均通过，但真实宿主/登录会话和生产发布安全扫描
  仍是未完成证据，不得用“build 通过”覆盖。
