# Agent / 工具链迭代报告 · 第二份（2026-11-12）

第一份记录见 [2026-11-11-agent-tool-eval.md](2026-11-11-agent-tool-eval.md)。本记录只收第一份之后新增的改动，不重复已完成项。

## 本轮目标

1. 清掉挤乱底部工具条的“重跑过期节点”长按钮。
2. 让旧手动分组在迁移后重新出现，并修正组内拖动语义。
3. 给外部 Agent 一份可直接复制的本地接入提示词。
4. 补齐视频反推、音频变调与 LibTV 式音频卡。
5. 裁剪图片工具：移除标注、打光、风格、移动；把扩图、蒙版开放给 Agent。

## 变更

### 工具条与分组

- `重跑 N 个过期节点` 从居中的主胶囊工具条移入「工具箱」菜单；主工具条只保留画布控制。
- 手动分组改为中性灰 + 透明玻璃；点击组框空白处即可选中/拖动整组，不再只依赖左上角标签。
- 组框整组选中后，直接拖组内某个节点只移动该节点；组框随内容重算包围盒。移动整组走组框空白处或标签。
- 迁移补齐旧数据：没有 `batchGroupSource` 且没有 `batchIndex` 的 `batchId` 组恢复为 `manual`，避免被当成自动批次折叠。

### 外部 Agent 交接

- Agent 连接页新增「给其他本地 Agent 的提示词」，中英文各一份，一键复制。
- 提示词覆盖：GitHub 源码、clone/install、`flovart ensure/status/inspect`、`workflow.apply` 的 `projectId/expectedRevision/mutationId` 约束、Skill 路径，以及 DSH 可选路径。
- 明确非 DSH Agent 也能通过本地 CLI 操作可见 Workflow。

### 反推、音频、Agent 工具

- 反推提示词扩展到视频：优先视频封面，没有封面时抽首帧；结果写回节点 prompt。
- 音频节点改为 LibTV 式卡片：截取 / 变速 / 变调 / 人声分离、波形、原生播放器、文件名与时长。
- 新增 `audio.pitch@1`（±12 半音）；新增 Agent 工具 `audio-pitch`。
- Agent 工具面补充：`vectorize`、`reverse-prompt`、`filter`、`outpaint`、`mask`。
- `mask` 支持 `maskNodeId` 或 `maskHref`/`maskMimeType`，Agent 可以引用已有蒙版图或传 data URL，但不能自己用鼠标画蒙版。
- 图片工具栏移除：标注涂鸦、打光面板、视角与风格、移动物体。扩图与蒙版保留 UI。

## 验证

- `npx tsc --noEmit`：通过。
- 最新定向回归：图片工具、节点覆盖、节点工具、音频 Operation 共 50 项通过；此前音频/反推/Agent 页面等 94 项通过。
- 生产构建通过；浏览器实测音频卡、分组框、反推入口与工具箱重跑菜单。
- 交付：`83e3da2` → Pages `929e085b.flovart-b5a.pages.dev`；DSH webui 已重建安装。

## 未完成 / 下一轮

1. 标注、打光、风格、移动已从 UI 移除，旧对话框代码与类型仍可清理，避免死代码。
2. Agent 的蒙版仍要求已有蒙版节点或 data URL；还不能由 Agent 生成像素级自由手绘蒙版。
3. 音频变调基于 ffmpeg `asetrate + atempo`，非专用音高算法；对 44.1k 之外的源可能有偏差。
4. 视频反推只取封面/首帧，不是整段视频理解。
5. 分组框还没有 padding、嵌套组、组级右键菜单。
