---
title: Excalidraw 迁移可行性评估
---

## 背景

当前 Canvas 使用自研 SVG + Konva + foreignObject 方案，存在结构性缺陷：
- foreignObject 内的 HTML 覆盖层（PromptBar、ElementToolbar）坐标错乱
- tippy 弹窗在 transform: scale 下定位失败
- 滚轮事件冒泡冲突
- 键盘事件被 SVG 吞掉

Jaaz（6.4k stars 开源 Canva AI 替代品）使用 Excalidraw 作为画布引擎，无需 foreignObject hack。

## 重构原则

**不新建页面，直接重构 App.tsx 老 Canvas 入口。** 保留所有现有 handler、状态、动画、组件，只替换渲染层。

## 老 Canvas 功能清单（必须保留）

### 渲染层（要替换）
- `<svg>` + `<g transform="translate(pan) scale(zoom)">` 画布渲染
- 元素渲染：image/video/text/shape/path/arrow/line/group
- 选中框：selectionComponent（SVG rect 虚线）
- 关系聚焦框：relationFocusComponent（SVG rect 紫色虚线）
- foreignObject：PromptBar、ElementToolbar、文本编辑、视频播放
- Konva 媒体层（已注释，不用管）

### 外层逻辑（全部保留，不动）
- `handleNodePromptGenerate` — AI 生成提交
- `handleStopNodePromptGeneration` — 停止生成
- `updateNodePromptPayload` — 更新提示词
- `updateNodePromptStatePatch` — 更新生成状态
- `getInlineApiKeyForElement` — 获取 API Key
- `resolveColdMediaRef` — 冷存储解析
- `handleAddMediaElement` — 添加媒体
- `handleDeleteElement` — 删除元素
- `handleCopyElement` — 复制元素
- `handleDownloadImage` — 下载图片
- `handleExportSelectedMedia` — 批量导出
- `handleReversePrompt` — 反推 Prompt
- `handleStartCrop` / `handleConfirmCrop` / `handleCancelCrop` — 裁剪
- `handlePropertyChange` — 属性修改
- `handleLayerAction` — 图层操作
- `handleGroup` / `handleUngroup` — 分组/取消分组
- `handleUndo` / `handleRedo` — 撤销重做
- `commitAction` — 提交历史
- `useCanvasInteraction` — 鼠标交互 hook
- `buildElementPromptGenerationState` — 构建 Prompt 状态
- `buildElementIgnitionReferences` — 构建 @ 引用
- `buildAttachmentIgnitionReferences` — 构建附件引用
- `executeUnifiedIgnition` — 统一生成入口

### 覆盖层组件（保留，改定位方式）
- `PromptBar` — 带模型选择/比例/时长/批量/生成按钮/状态/动画
  - `inline-prompt-bar { transition: left 100ms, top 100ms }` 滑动动画保留
  - `RichPromptEditor` + tippy @ 引用
  - `canvasElements` prop → `mentionItems`
- `ElementToolbar` — 对齐/复制/下载/删除/裁剪/滤镜/放大/去背景/扩图/蒙版/图层拆分
  - `isl-shell isl-pop-in` 弹出动画保留
- `ImageFilterPanel` — 图片滤镜
- `CanvasSettings` — 设置面板
- `WorkspaceSidebar` — 左侧图层面板
- `RightPanel` — 右侧素材/历史
- `Toolbar` — 底部工具栏（要优化）
- `ABCompareOverlay` — A/B 对比
- `OnboardingWizard` — 引导
- `DiagnosticBar` — 诊断

### 状态（全部保留）
- `boards` / `activeBoardId` / `activeBoard` — 画板管理
- `elements` / `history` / `historyIndex` — 元素 + 撤销历史
- `selectedElementIds` — 选中
- `panOffset` / `zoom` — 视口
- `activeTool` / `drawingOptions` — 工具
- `croppingState` — 裁剪
- `editingElement` — 文本编辑
- `nodePromptAttachments` — 节点附件
- `modelPreference` / `userApiKeys` — 模型/Key
- `reversePromptLoading` — 反推
- `filterPanelElementId` — 滤镜面板
- `outpaintMenuId` — 扩图菜单
- `maskEditingId` — 蒙版编辑
- `relationFocusElementId` — 关系聚焦

## 重构方案

### 1. 替换渲染层

把 `<svg>...</svg>` 整块替换为：
```tsx
<ExcalidrawInner
  theme={resolvedTheme}
  onApiReady={api => excalidrawApiRef.current = api}
  onSceneChange={(excalElements, selectedIds, viewport) => {
    // 同步到老状态
    syncExcalidrawToFlovart(excalElements, selectedIds, viewport);
  }}
  onContextMenu={handleContextMenu}
/>
```

### 2. PromptBar foreignObject → 覆盖层

老代码（foreignObject）：
```tsx
<foreignObject x={el.x + el.width/2 - 360/zoom} y={el.y + el.height + 16/zoom} width={720/zoom} height={800/zoom}>
  <div style={{ transform: `scale(${1/zoom})` }}>
    <div className="inline-prompt-bar" style={{ width: '720px' }}>
      <PromptBar ... />
```

新代码（position: fixed 覆盖层）：
```tsx
{selectedNodePromptElement && !croppingState && !editingElement && (
  <div
    className="inline-prompt-bar"
    style={{
      position: 'fixed',
      left: `${overlayCenter - 360}px`,  // 同老逻辑算坐标
      top: `${overlayBottom + 12}px`,
      width: '720px',
      transition: 'left 100ms ease-out, top 100ms ease-out',  // 保留滑动动画
    }}
  >
    <PromptBar ... />  {/* 所有 props 不变 */}
  </div>
)}
```

坐标计算用 Excalidraw viewport：
```ts
const overlayCenter = viewport.x + (el.x + el.width/2) * viewport.zoom;
const overlayBottom = viewport.y + (el.y + el.height) * viewport.zoom;
```

### 3. ElementToolbar foreignObject → 覆盖层

老代码（foreignObject + transform scale）：
```tsx
<foreignObject x={bounds.x} y={bounds.y - 56/zoom} width={toolbarW/zoom} height={toolbarH/zoom}>
  <div style={{ transform: `scale(${1/zoom})` }}>
    <ElementToolbar ... />
```

新代码（position: fixed）：
```tsx
{selectedElementIds.length > 0 && !croppingState && (
  <div style={{ position: 'fixed', left: `${toolbarLeft}px`, top: `${toolbarTop}px` }}>
    <ElementToolbar ... />  {/* 所有 props 不变 */}
  </div>
)}
```

### 4. 底部工具栏优化

参考 Jaaz，工具栏加：
- **涂鸦**：映射 Excalidraw freedraw 工具
- **选择/平移**：映射 selection/hand
- **形状组**：矩形/圆/菱形/箭头/线条
- **文本**：映射 text
- **图片**：上传图片
- **AI 分层**：一键把选中图片拆分图层（调 handleSplitImageLayers）
- **导入 Agent**：把选中元素发送到右侧 Agent chat（参考 Jaaz CanvasPopbar 的 AddToChat）
- **撤销/重做/缩放**

### 5. 选中元素 Pop-bar（参考 Jaaz）

选中图片时，元素下方弹出小气泡：
- "导入 Agent" — 把图片加入 Agent 对话
- "魔法生成" — 选中多个元素 → 截图 → 发给 Agent 生成
- `motion` 弹出动画

### 6. 元素类型转换层

```ts
// Flovart Element → Excalidraw Element
function flovartToExcalidraw(el: Element): ExcalidrawElement {
  // image → Excalidraw image（fileId + dataURL）
  // video → Excalidraw embeddable（link = blob URL）
  // text → Excalidraw text
  // shape → Excalidraw rectangle/ellipse/diamond
  // path → Excalidraw freedraw
  // arrow → Excalidraw arrow
  // line → Excalidraw line
}

// Excalidraw Element → Flovart Element
function excalidrawToFlovart(el: ExcalidrawElement): Element {
  // 反向映射
}
```

## 迁移步骤

### 步骤 1：替换渲染层
- App.tsx 的 `<svg>` 替换为 `<ExcalidrawInner>`
- 实现 `syncExcalidrawToFlovart` 双向同步
- 保留 `useCanvasInteraction` 但只用于键盘/粘贴

### 步骤 2：PromptBar + ElementToolbar 改覆盖层
- foreignObject → position: fixed
- 坐标用 Excalidraw viewport
- 保留 transition 动画

### 步骤 3：底部工具栏优化
- 涂鸦/选择/平移/形状/文本/图片
- AI 分层按钮
- 导入 Agent 按钮

### 步骤 4：Pop-bar
- 选中图片 → 底部弹出气泡
- 导入 Agent / 魔法生成

### 步骤 5：补全
- 裁剪/滤镜/蒙版/扩图（复用老 handler）
- 右键菜单
- 冷存储适配

## 风险

- **App.tsx 4700 行**，改动范围大，容易破坏
- **元素类型转换**需要仔细处理，尤其 image 的 fileId + dataURL
- **多画板**：Excalidraw 单实例，切换画板需要 reload initialData
- **性能**：Excalidraw 大量元素时可能不如 Konva
