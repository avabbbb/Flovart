# 模块：Canvas / Workflow

> 状态：**Current truth**。总纲见[总体设计](00-overview.md)，交互规则见[交互设计](01-interaction.md)。

## 1. 职责

Canvas 是空间化的 Workflow 创作面：节点、素材、连线、生成与结果编辑。人和 Agent 操作的是**同一份可见 Workflow**；复杂制作（多镜头、依赖、版本比较）都在这里完成。宿主面板的 “Open in Flovart” 落到这里。

不承担：冒充宿主 Timeline / Media Pool；第二套 Workflow；Agent 全页聊天。

## 2. 当前实现（已实现）

| 部分 | 位置 |
| --- | --- |
| 画布与节点 UI | `components/workflow/`（`InfiniteWorkflow`、`WorkflowNode`、`WorkflowToolbar`、`WorkflowNodePromptBar`…） |
| 状态与存储 | `components/workflow/store.ts`、`storage.ts`、`migrations.ts`（localforage） |
| 结构化修改 | `operations.ts`、`operationRegistry.ts`、`agentOps.ts` |
| 输入整理 | `inputResolver.ts`、`references.ts` |
| 节点插件 | `nodePluginSdk.tsx`（受信任的进程内代码，故障隔离 ≠ 安全沙箱） |
| 本地文件夹素材 | `LocalFolderBrowser.tsx`、`services/localFolderSource.ts` |

节点类型：图片、视频、音频、文本、配置；支持引用、连线、局部媒体工具（ffmpeg.wasm 在浏览器内运行）和可见结果。

设计目标：内置 `subgraph` 节点（子画布）。由 Reverse 一键生成，metadata 记 `reverseProjectId` / `collapsed`，子节点用可选 `parentId` 归属；文档保持扁平 nodes + connections，修改仍走 `workflow.apply`。双击进入 Reverse。`batchId` 分组语义（同批候选）不复用。详见 [11-reverse](11-reverse.md)。

## 3. 数据与权威

- **Browser Workflow 是稳定 Agent 操作的可见权威**（当前）。迁移权威必须先改 contract，再改实现和文档。
- 每次结构化修改携带 `projectId`、`expectedRevision`、`mutationId`：同 ID 同载荷重试返回原结果；同 ID 不同载荷拒绝；版本冲突要求重读。
- 没有可用 Browser workspace 时返回 `WORKSPACE_UNAVAILABLE`，不回退到随机或最近项目。
- 素材进入节点的两种语义：
  - **导入副本**（粘贴、拖入、外部来源）：`ingestWorkflowMedia` 写入浏览器媒体存储。
  - **引用**（用户授权的本地文件夹）：`local-folder:<folderId>/<相对路径>`，不复制字节；失效时提示重新定位，不按文件名猜。
- **视频编码兼容（已知坑，很多网站都有）**：浏览器 `<video>` 只稳定支持 H.264（及 VP9/AV1）。H.265/HEVC 即使系统和 Chrome 支持，也只限 4:2:0 的 Main/Main10；剪映等导出的 HEVC Rext 4:2:2（`yuv422p`）、ProRes 解不了。症状：元数据正常（有宽高、时长）但首帧解不出来 → 黑屏、无封面；或只解出音轨（`videoWidth === 0`）。排查用 `ffprobe -show_entries stream=codec_name,profile,pix_fmt`。
  - 处理：`ingestWorkflowMedia` 先用 `isBrowserDecodableVideo` 探测，以首帧 `loadeddata` 为准（不能只看 `loadedmetadata`）；不可解码就经 `transcodeVideoToH264`（ffmpeg.wasm，libx264 + yuv420p + AAC）转 H.264 MP4 再入库。上传、拖入、节点「替换」都走这条路径。
  - 局限：修复前已入库的节点不会自动转码，需「替换」重新导入；本地文件夹**引用**不复制字节，也不转码。
  - ffmpeg.wasm 默认单线程 core：core-mt 在 COOP/COEP（crossOriginIsolated）下会把渲染进程搞崩（`Crashpad_NotConnectedToHandler`，try/catch 接不住），见 `services/ffmpegClient.ts`。
- 结果有版本；晚到结果作为新版本，不覆盖用户已选版本。

## 4. 交互要点（补充交互设计）

- PromptBar、ElementToolbar、原始媒体比例行为保持现状。
- 运行：单节点或下游；只重跑受影响节点（设计目标：可见的 stale 状态与选择性重跑，需依赖 / 版本证据后才对外宣称）。
- 运行中改参：本次运行继续，修改下次生效。
- 选项（模型、参数、工具）全部来自 Route Capability Schema 与工具目录（`nodeToolCatalog.ts`），不在组件里写死。
- 布局按交互设计 §8：Canvas 自己拥有 pan / zoom，不被 UI inset 计算污染。

## 5. 对 Agent 暴露的操作

稳定操作：`workflow.inspect`、`workflow.selection.get`、`workflow.apply`、`workflow.node.run`（加 `status`）。其他 helper 仅在 Skill 明确需要时教给 Agent，并走同一 mutation 边界。详见 [12-agent](12-agent.md)。

## 6. 已知缺口

- `workflow.project.use` 应为跨进程激活握手（Agent 请求 → Browser 激活 → 快照回推 → 新目标确立后才返回）；当前实现未完成，记录于 pending-test。
- `workflow.node.run` 只返回不透明 artifact identity；Browser artifact registry 有容量与时效限制，宿主需要的持久文件交接未打通。
- Settings 等界面仍有中文硬编码，违反交互设计 §3，待 i18n 收敛。
- 大图性能：缩略图按需生成、离屏播放器暂停，按实际问题优化。

## 7. 验证

Workflow 编辑 / 引用一致性 / 键盘操作单测；`npm run test:browser:responsive`（Chrome for Testing）覆盖多尺寸；修改类变更需跑 mutation 幂等与版本冲突测试。
