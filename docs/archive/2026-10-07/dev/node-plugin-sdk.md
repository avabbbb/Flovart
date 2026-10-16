# Workflow Node Plugin SDK

## 边界

Workflow Node Plugin 是 Workflow 的扩展节点，不是第二个 Runtime、Provider 或状态仓库。插件只通过 `WorkflowNodePluginContext` 读取项目快照、提交结构化 Document Ops、使用自己的持久化命名空间和进程内事件通道。

插件不得直接导入 `InfiniteWorkflow` 内部实现、Provider/Gateway、Runtime DB、React store 或凭据。生成输入仍由现有 `WorkflowResource`、`CanonicalGenerationInput` 和 `WorkflowExecutor` 负责。

## 最小定义

```ts
interface WorkflowNodePluginDefinition {
  pluginId: string;
  type: string;
  version: string;
  title: string;
  outputs(node): WorkflowResource[];
  inputs?: WorkflowNodePluginInput[];
  render(props): ReactNode;
  panel?(props): ReactNode;
  toolbar?(props): ReactNode;
  onDoubleClick?(context): void;
}
```

宿主将 `outputs` 映射为既有 `WorkflowNodeDefinition.output`，所以输入解析和下游生成不需要认识插件类型。内部历史定义可以暂时提供 `output`，新插件应使用 `outputs`。

Context 提供：

- `node`、`getNodes()`、`getUpstream()`：只读快照；
- `applyOps()`、`updateMetadata()`：进入 Workflow 的统一 Document Mutation 入口；
- `storage`：按 `projectId/pluginId/nodeId` 隔离的 localforage 命名空间；
- `events`：按项目和插件隔离的轻量事件通道。

## 生命周期

`WorkflowNodePluginRegistry` 负责 `install`、`update`、`enable`、`disable` 和 `uninstall`。插件 ID 与节点类型必须唯一。禁用或卸载不会删除已有项目节点；节点保留为不可用占位，重新安装同一插件后即可恢复渲染和资源输出。

当前 reference plugins：`flovart.markdown`、`flovart.storyboard-card`、`flovart.style-bible`。
