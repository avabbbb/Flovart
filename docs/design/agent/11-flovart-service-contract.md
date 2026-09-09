# SPEC-001：`ctx.flovart` Service Contract

> 当前实现说明。早期版本曾把 Binding、Native Draft 和 DSH 自己的 Workflow
> store 放进这个设计；这些边界已由 [ADR 0063](../../adr/0063-dsh-browser-workflow-authority.md)
> 取代。当前唯一 Workflow authority 是可见的 Flovart Browser Workflow。

## 目的

为 DeepSeek Harness 的 Agent tools 和 contextual view 提供一个稳定、最小的
Flovart 能力入口。调用方不直接请求 Flovart Agent HTTP、读取 Browser
IndexedDB、操作 React Canvas 或启动第二个 Workflow Runtime；Node/Cordis
Service 通过 Flovart CLI contract 进入现有 Workspace Adapter、Draft Authority、
WorkflowExecutor 和 Artifact 边界。

## 当前 Service Interface

实际公开的 `ctx.flovart` 形状是：

```ts
interface FlovartService {
  status(signal?: AbortSignal): Promise<unknown>
  ensure(signal?: AbortSignal): Promise<unknown>

  workspace: {
    inspect(args?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
    selection(args?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  }

  workflow: {
    apply(args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
    run(args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  }

  artifacts: {
    get(args?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  }
}
```

Workflow 调用会固定 `workspaceMode: "browser"`，并以
`agentIdentity: "deepseek-harness"` 进入稳定 CLI；没有可见 Browser Workflow
时返回 `WORKSPACE_REQUIRED` 或 `WORKSPACE_UNAVAILABLE`，不创建空项目、不读取
旧项目，也不回退到隐藏 Draft。

## 工具投影

模型工具只投影五个稳定命令：

```text
flovart_status
flovart_inspect
flovart_selection
flovart_apply
flovart_run
```

工具 schema 从 `flovart command.list --json` 的当前 Registry 读取，但只允许
上述白名单；`command.list`、`command.schema`、`director.*`、Provider、Crew
和内部诊断命令不进入模型工具面。写操作要求稳定的幂等键，Workflow mutation
还由可见 Browser 的 `expectedRevision`、`mutationId` 和 Workspace Lease 校验。

## Artifact

`ctx.flovart.artifacts.get({ taskId })` 只把现有 Runtime Task 的非秘密 Artifact
描述投影给 DSH。它不扫描 Asset store、不返回 Provider credential、原始本地
路径或隐藏 Workflow 数据；没有成功 Artifact 时返回结构化失败。

## 生命周期与错误

`FlovartService` 是 Cordis Service。CLI probe 失败时服务进入不可用状态，依赖
它的工具由 Cordis 注销；health monitor 恢复 probe 后重新注入，不能缓存 stale
Service reference。Host proxy 只暴露同源的 `GET /flovart-workspace/health` 和
`POST /flovart-workspace/api/tools`，Workspace token 只存在 Host 环境。

产品层错误至少映射为：

```text
HOST_NEEDS_SETUP
HOST_NEEDS_LOGIN
LINK_OFFLINE
WORKSPACE_REQUIRED
WORKSPACE_UNAVAILABLE
LEASE_EXPIRED
LEASE_TARGET_CHANGED
REVISION_CONFLICT
INPUT_RESOLUTION_FAILED
RESOURCE_NOT_EXECUTABLE
UNSUPPORTED_INPUT_MODE
PROVIDER_REQUEST_FAILED
HOST_IMPORT_FAILED
```

UI 只显示发生了什么、下一步怎么修和 CTA；协议错误码与 transport 细节留在
Developer Diagnostics。

## 验收边界

- DSH Agent tools、CLI 和 contextual view 对 Workflow 修改最终进入同一个
  Browser Workflow Dispatcher；不存在 DSH Native Draft 或第二条 Provider 路径。
- 关闭 Browser client、切换项目或 stale revision 时必须失败安全，不误写其它项目。
- 同一个 `mutationId + payload` 重试必须重放原 Receipt；不同 payload 必须拒绝。
- packed profile、Host/Client bundle、proxy 白名单和 Cordis unload/reload 可以
  在本地 contract suite 验证，但真实 DeepSeek 登录会话和页面 tracer 仍是
  External Gate。
