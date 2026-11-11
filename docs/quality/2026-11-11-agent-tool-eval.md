# Agent / 工具链迭代报告（2026-11-11）

## 目标

这一轮不是继续堆工具，而是把 Agent 和可见 Workflow 之间的契约收紧：

1. 核对上一份外部 Agent 报告中的结论，区分真实缺陷、误判和过度设计。
2. 让「提示词」只有一个事实来源，文本节点回归备注。
3. 把图片/视频工具从“按钮很多但不知道能不能用”改成可验证的执行面。
4. 给 Agent 更轻的读取、写入预演和镜头控制。

## 外部方案的核对结论

| 报告结论 | 核对结果 | 处理 |
|---|---|---|
| 拆分图层走图片生成、必然空输出 | 误判。`services/aiGateway.ts` 实际请求 `/split-layers`，`resolveImageRoute` 只取 route/key | 不做模型替换；补 endpoint readiness 与显式错误 |
| 反推 Prompt 能力缺失 | 误判。`App.tsx` 已有 `image-understanding` 路由和流式实现 | 补进度/成功/失败反馈与按钮门禁 |
| 连线没有合法性校验 | 误判。`components/workflow/ops.ts` 已有角色、重复边、环检测 | 增加 `workflow.apply --dryRun`，不引 React Flow |
| 应上 Yjs/Automerge | 不适用。当前是单机 revision + mutation + draftAuthority | 保留现有版本模型，增加轻量 inspect 投影 |
| 应上 zundo 回滚 | 过度设计。已有 ChangeSet / redo / snapshot | 不引入第二套 undo owner |
| 固定偏移导致节点重叠 | 成立。操作节点原来只有 `anchor + 64` | 已改为包围盒避让，操作与输出节点都检查碰撞 |
| LayerD / Florence-2 | 方向成立，但都是 Python/GPU 服务，不是浏览器依赖 | 作为可选 sidecar 端点保留，不默认打包 |
| glasscn-ui | 不采用。npm 包旧且已归档 | 继续使用现有 `--wf-*` token |

## 本轮落地的改动

### 1. 文本节点 = 备注

- `text` 节点默认标题改为「备注」，创建菜单、工具栏、占位文案同步。
- `inputResolver` 不再把上游文本收进生成输入；`workflowGeneration` 不再拼接 `texts`。
- `image.generate@1` 移除 `prompt_context` 输入角色；Operation 只绑定图片。
- 连线校验禁止备注进入/离开生成节点。
- 模板与示例画布删除“提示词文本框”；示例脚本成为独立备注。
- 迁移 v3：旧文本→生成连线断开，目标 ID 记入 `noteMergeTargetIds`；备注工具栏提供一次性「并入下游提示词」。
- 「生成资产」从备注派生图片时，把备注原文直接写进新节点 prompt，不再靠隐式连线。

### 2. 裁剪 v2

- 裁剪弹窗改为画布内拖拽选区 + 8 个手柄。
- 比例：自由、原图、1:1、4:3、3:4、16:9、9:16；数值输入保留。
- 重置与实时预览；复用 `image.crop@1`，不新增能力。
- 「宫格切分」从图片主工具位移到「更多 → 输出」，不再与语义分层混在一起。

### 3. 视频工具

- 视频剪辑与指定帧提取共用帧主轴：拖动进度条会主动 seek `<video>`，画面同步跳转。
- 帧率通过 `requestVideoFrameCallback` 估算（失败回退 30），可手动修正；界面显示时间码 `HH:MM:SS:FF`。
- 剪辑改为按帧重编码（libx264），避免 stream copy 的关键帧错位；默认 `accurate: true`。
- 剪辑支持入点/出点帧、±1 帧、±1 秒、播放/暂停、设为入点/出点。
- 提取帧支持目标帧、帧率、时间码、步进和同步预览。
- 三个视频/音频弹窗统一到扁平玻璃主题。

### 4. 工具可执行性与信息架构

- 工具栏动作支持 `hint`：不可用时 native tooltip 说明原因。
- 拆分图层在没有图片工具 endpoint 时禁用，并说明需要 `/split-layers`；反推 Prompt 在没有文本/视觉路由时禁用。
- 图片溢出菜单按「编辑 / AI 工具 / 输出」分组；本地工具与 Provider 工具不再平铺混排。
- 宫格切分降级为输出工具，默认 2×2（实现仍读注册表默认）。

### 5. 分组框

- 分组框从按 hue 的绿色改为中性灰 + 透明玻璃背景，标签使用同一套灰色。
- 分组框本身可点击：点击框内非节点区域即选中整组并开始拖动；不再只能点左上角标签。

### 6. Agent 工具面

- `workflow.inspect` 新增：
  - `summary: true`：轻量图，只给 id/type/title/position/size/status。
  - `nodeId`：单节点 + 直接入/出边。
- `workflow.apply` 新增 `dryRun: true`：返回将新增/删除的节点与连接，或返回与真实 apply 相同的拒绝原因。
- 新增 `workflow.focus.nodes`：按节点包围盒居中/缩放，不推进草稿版本。
- 同步 CLI registry、MCP 映射、Managed Agent 工具面和 Skill 文档。

## 验证

- `npx tsc --noEmit`：通过。
- 定向回归：文本输入、模板、迁移、图片工具、视频工具栏、dispatcher、ops、资源契约共 128 项通过。
- 全量回归：`npx vitest run` — 306 个测试文件、1871 项通过、1 项跳过。
- 生产构建：`npm run build` 通过。
- 浏览器实测：
  - 备注节点选中后不出现生成提示词栏；
  - 图片节点反推/拆分在无服务时禁用并显示原因；
  - 裁剪弹窗可拖拽、比例按钮与数值输入正常；
  - 视频剪辑/指定帧弹窗显示帧、时间码，拖动进度条画面同步变化；
  - 示例画布打开后备注与镜头独立。

## 未完成 / 下一轮

1. **拆分图层的真正语义端点**：前端契约已收紧，但还没有内置 LayerD/BiRefNet 服务；需要桌面 sidecar 或自托管 `/split-layers`，并实测照片主体/背景质量。
2. **精确帧率**：浏览器只能估算 fps；若要严格帧号，需要 ffprobe 元数据或容器解析。
3. **视频剪辑体验**：目前逐帧重编码，长视频会慢；下一轮可加缩略图时间轴、关键帧提示、后台任务进度。
4. **Agent 历史**：inspect 现在能减重，但还没有完整 changeSet 分页/差分；Yjs 仍不引入。
5. **分组框**：视觉与点击已修，还没有加入组内 padding 调整、嵌套组和组级右键菜单。
