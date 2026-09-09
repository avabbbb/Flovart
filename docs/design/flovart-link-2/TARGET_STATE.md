# Flovart Link 2.0：目标状态

这份文档定义重构边界。它不把尚未通过真实/最近似 tracer 的能力写成已支持能力。

## 单一产品架构

```text
Codex ───── Skill ─────────┐
WorkBuddy ─ Connector/Skill ┤
DSH ─────── Native Plugin ──┤
Photoshop ── Studio Adapter ┤
Premiere ─── Studio Adapter ┤
AE ───────── Studio Adapter ┤
Resolve ──── Studio Adapter ┘
                         ↓
                  Flovart Link
          detect / prepare / activate / recover
                         ↓
                  Workspace Lease
                         ↓
                   Agent Surface
                         ↓
                  Workflow Dispatcher
                         ↓
               WorkflowExecutor + Provider
```

Link 是 lifecycle coordinator，不是第二个 Runtime。它统一 host discovery、准备、激活、health/recovery 与 workspace lease；Workflow truth 与执行语义最终只能由 Flovart Core 持有。DSH 的 native plugin 只提供 Harness 原生槽位中的 contextual view/service，不能成为 Host 自己的第二套 mutation/execution authority。

## 不变量

1. 所有 document mutation 通过 `workflow.apply` 与现有 mutation core 提交；granular command 只能是兼容入口，不成为 Host-specific authority。
2. 所有 generation 经过 `WorkflowExecutor → CanonicalGenerationInput → Provider Adapter`。
3. Host 只能把 context/selection 转成 Flovart contract，不持有 Workflow truth、资源解析器、artifact store、Provider credential 或 Canvas mutation semantics。
4. Browser Workflow 被声明为 authority 时，没有 workspace 必须结构化失败；绝不根据 `lastFocusedProject`、随机 active tab 或旧 snapshot fallback。
5. 参考素材存在但 Provider 不支持该模式时返回 `UNSUPPORTED_INPUT_MODE`，不把 I2I/I2V 静默降级为 T2I/T2V。
6. 普通产品层只有 `ready`、`needs_setup`、`needs_login`、`offline`；协议、token、PID、port、SSE、writer 等只在 Developer Diagnostics。

## Link public API 与内部层

目标内部模块可按现有边界收敛为：

```text
services/link/
  hostDefinition.ts
  hostRegistry.ts
  hostDetection.ts
  hostPreparation.ts
  hostActivation.ts
  workspaceLease.ts
  connectionHealth.ts
  recovery.ts
  publicStatus.ts
```

Host definition 只声明 identity、kind、capability 与薄 adapter；重试、timeout、workspace selection、JSON transport、Browser binding 不得在 Host 定义中复制。

```ts
interface FlovartHostDefinition {
  id: string
  label: string
  kind: 'coding-agent' | 'assistant' | 'native-plugin'
  detect(): Promise<HostDetection>
  inspectAuth?(): Promise<AuthState>
  prepare(): Promise<PreparationResult>
  activate(): Promise<ActivationResult>
  repair?(): Promise<RepairResult>
  capabilities: {
    inspect: boolean
    mutate: boolean
    run: boolean
    selection: boolean
    plugin?: boolean
  }
}
```

## `ensure` 语义

`flovart ensure --json` 只是 Link 的 lifecycle convenience command：

```text
status
→ ensure local service/runtime
→ ensure frontend
→ ensure browser workflow when Browser authority is requested
→ ensure active host projection when applicable
→ return public readiness
```

它必须复用既有启动器和 coordinator，不得启动第二个 Agent/Runtime。输出可以带机器所需的 project/revision/opaque lease metadata，但正常 UI/Skill 不显示 raw URL、token、port 或 session internals。

## Workspace Lease 目标

一次 Agent mutation turn 绑定：

```text
leaseId
agentIdentity
clientId
projectId
baseRevision
issuedAt
expiresAt
```

`inspect → apply → run` 必须沿用同一 lease；每次 mutation 至少验证 lease、project、expected revision、mutationId。`mutationId` 重放必须返回原 receipt，不创建第二个节点/边/任务。

需要结构化返回：`LEASE_EXPIRED`、`LEASE_TARGET_CHANGED`、`REVISION_CONFLICT`、`WORKSPACE_UNAVAILABLE`。关闭原 Tab、切换当前项目或 writer 改变时，旧 lease 只能继续写原 project，或安全失败。

## Studio Host Platform 目标

Studio 是 contextual inspector，不是缩小版无限画布。统一 Host contract：

```ts
interface CreativeHostAdapter {
  id: string
  getContext(): Promise<HostContext>
  getSelection(): Promise<HostSelection>
  materializeSelection(selection: HostSelection): Promise<MaterializedHostSelection>
  importArtifact(artifact: FlovartArtifact, target?: HostImportTarget): Promise<HostImportResult>
  subscribeContext?(listener: (context: HostContext) => void): Disposable
}
```

Host selection 只进入已有 `WorkflowResourceReference → ExecutableResourceResolver → ResolvedResource → CanonicalGenerationInput`。禁止 `PhotoshopGenerationInput` 等 Provider-specific model。

共享 UI 只负责 selection/reference chips/prompt/skill/run/result/error/cost confirmation/open canvas；280–420px 为 compact inspector，宽屏才显示 mini workflow preview，复杂编排使用“在 Flovart 中打开”。

 Photoshop 是第一条强制真实 Studio tracer：selected layer → I2I → new layer，原 layer 不变。Premiere 第一版为 selected clip/current frame → generation → Project import。AE/Resolve 已有同一 Resource Contract 的宿主包，但没有真实 host 证据前只能标 Experimental。

## 证据策略

- contract/mock/fixture 只能证明边界和序列化，不等于第三方 Host 已认证。
- 每个 external gate 必须有可重复的 command/checklist、预期证据和当前状态。
- 最终 Support Matrix 依据 tracer、package build、contract tests 和人工证据逐项标记；有 adapter interface 不等于 Supported/Stable。
