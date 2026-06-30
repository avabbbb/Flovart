# 模块 04 — 图像工具

> LibTV 图像节点上的完整工具集，对照 Flovart 已有 7 种工具的 gap
> 日期: 2026-06-29

---

## 1. LibTV 图像工具清单

### 1.1 全景 720°
- 输入: 1 张图
- 实时预览 720° 全景
- 截取 4 视角或 12 视角截图
- 输出: 全景图 + 多张视角截图

### 1.2 多角度
- 输入: 1 张图
- 3D 坐标球交互(拖拽球面选角度)
- 8 水平角度 / 4 垂直角度 / 3 景别
- 输出: 选定角度的新图

### 1.3 打光
- 输入: 1 张图
- 26 主光预设 + 9 轮廓光预设
- 亮度调节 + 颜色调节
- 智能模式(自动分析场景打光)
- 预设组合
- 输出: 重新打光的图

### 1.4 九宫格
- 输入: 1 张图
- 输出: 9 宫格变体图(同模块03多机位)

### 1.5 基础编辑
| 工具 | 说明 |
|------|------|
| 高清 | 超分放大 |
| 扩图 | outpaint 四周扩展 |
| 重绘 | 局部重绘(inpaint) |
| 擦除 | 擦除区域 |
| 抠图 | 移除背景 |
| 裁剪 | 裁取区域 |

### 1.6 宫格切分
- 输入: 1 张拼图(如九宫格拼图)
- 输出: 自动切分成多张子图(每格一张)
- 用于从拼图提取独立分镜

### 1.7 标注
- 涂鸦: 自由画笔标注
- 框选: 矩形框 + 文字标注
- 输出: 带标注的图(非 AI 生成，纯叠加)

### 1.8 旋转镜像
- 旋转: 90°/180°/270°
- 镜像: 水平/垂直翻转
- 输出: 变换后的图

### 1.9 分镜组
- 输入: 多张分镜图
- 宫格布局(可选行列数)
- 拼接成一张大图
- 自动序号标注(1/2/3...)
- 输出: 拼接大图

---

## 2. Flovart 现状

### 2.1 已有工具 ✅

| Flovart 工具 | 对应 LibTV | 状态 |
|-------------|-----------|------|
| crop | 裁剪 | ✅ |
| filter | (无直接对应) | ✅ 有调色 |
| upscale | 高清 | ✅ |
| removeBackground | 抠图 | ✅ |
| outpaint | 扩图 | ✅ |
| mask | 重绘/擦除 | ✅ 局部遮罩 |
| splitLayers | (无直接对应) | ✅ 拆分图层 |

### 2.2 Gap ❌

| LibTV 工具 | Flovart | 差距 |
|-----------|---------|------|
| 全景 720° | 无 | 需全景生成 + 视角截图 |
| 多角度(3D坐标球) | 无 | 需 3D 角度交互 + 多角度生成 |
| 打光面板 | 无 | 需 26+9 预设 + 亮度颜色调节 |
| 九宫格 | 无 | 见模块03 Slash |
| 重绘(inpaint) | mask 已覆盖 | ✅ 基本对齐 |
| 擦除 | mask 可覆盖 | ✅ |
| 宫格切分 | 无 | 需图像切分服务 |
| 标注(涂鸦/框选) | 无 | 需标注叠加层 |
| 旋转镜像 | 无 | 需基础变换 |
| 分镜组(拼接+序号) | 无 | 需多图拼接 + 序号 |

---

## 3. 实现方案

### 3.1 旋转镜像(P0 — 最简单)
```ts
// services/imageTransform.ts
export function rotateImage(dataUrl: string, deg: 90|180|270): Promise<string>
export function flipImage(dataUrl: string, axis: 'h'|'v'): Promise<string>
// canvas transform，纯前端，无需 AI
```
- `WorkflowNodeToolbar` 新增旋转/镜像按钮
- `WorkflowImageToolDialogs` 新增 RotateFlipDialog

### 3.2 宫格切分(P0 — 简单)
```ts
// services/gridSplitter.ts
export function splitGrid(dataUrl: string, rows: number, cols: number): Promise<string[]>
// canvas 切分，返回每格子图 dataURL
```
- 每个子图创建独立 image 节点(横排排列)
- 新增工具: `splitGrid` (区别于 splitLayers 的 AI 拆分)

### 3.3 标注(涂鸦/框选)(P1)
```ts
// 新建 components/workflow/AnnotationDialog.tsx
// 复用 MaskDialog 的 canvas 绘画基础
// 模式: 涂鸦(自由画笔) / 框选(矩形) + 文字
// 输出: 原图 + 标注叠加层 → 合成 dataURL
```

### 3.4 分镜组拼接(P1)
```ts
// services/gridComposer.ts (模块03已定义)
export function composeStoryboard(
  images: string[],
  cols: number,
  showIndex: boolean
): Promise<string>
// canvas 拼接 + 可选序号文字
```
- 选中多张 image 节点 → 右键"拼接分镜组"
- 弹窗选行列数 + 是否显示序号

### 3.5 打光面板(P1)
```ts
// 新建 components/workflow/LightingDialog.tsx
const LIGHTING_PRESETS = {
  main: [/* 26 主光预设 */],
  rim: [/* 9 轮廓光预设 */],
};
// 参数: preset + intensity + color + smartMode
// 调图生图，prompt: "relight with {preset}, intensity {n}, color {c}"
```

### 3.6 多角度 3D 坐标球(P2)
```ts
// 新建 components/workflow/AngleSphere.tsx
// 3D 球面交互(可用 three.js 或 CSS 3D transform)
// 拖拽球面 → 选择角度
// 8 水平 / 4 垂直 / 3 景别
// 调图生图，prompt: "{angle} view, {elevation} angle, {shot type}"
```

### 3.7 全景 720°(P2)
```ts
// 需全景图生成模型(非标准能力)
// 1. 调图像模型生成全景图(prompt: "360 panorama, equirectangular")
// 2. 前端全景预览(可用 photo-sphere-viewer 或 pannellum)
// 3. 截取 4/12 视角: 从全景图裁取不同角度区域
```

---

## 4. 优先级

| 工具 | 优先级 | 理由 |
|------|--------|------|
| 旋转镜像 | P0 | 纯前端，零成本 |
| 宫格切分 | P0 | 纯前端，高实用 |
| 标注 | P1 | 纯前端叠加 |
| 分镜组拼接 | P1 | 纯前端拼接 |
| 打光面板 | P1 | 需 AI 但高频 |
| 多角度 3D 球 | P2 | 交互复杂 |
| 全景 720° | P2 | 需全景模型 |

---

## 5. 工具栏扩展

`WorkflowNodeToolbar.tsx` image 类型工具按钮新增:
```ts
// 旋转镜像
{ key: 'rotate', label: '旋转镜像', icon: <RotateCw />, onClick: () => imageTools.rotate?.(node.id) },
// 宫格切分
{ key: 'splitGrid', label: '宫格切分', icon: <Grid3x3 />, onClick: () => imageTools.splitGrid?.(node.id) },
// 标注
{ key: 'annotate', label: '标注', icon: <PenTool />, onClick: () => imageTools.annotate?.(node.id) },
// 打光
{ key: 'relight', label: '打光', icon: <Sun />, onClick: () => imageTools.relight?.(node.id) },
// 多角度
{ key: 'multiAngle', label: '多角度', icon: <Globe />, onClick: () => imageTools.multiAngle?.(node.id) },
// 全景
{ key: 'panorama', label: '全景720°', icon: <Panorama />, onClick: () => imageTools.panorama?.(node.id) },
```

`WorkflowImageToolKind` 新增:
```ts
export type WorkflowImageToolKind =
  | 'crop' | 'filter' | 'upscale' | 'remove-background'
  | 'outpaint' | 'mask' | 'split'
  // 新增
  | 'rotate' | 'splitGrid' | 'annotate'
  | 'relight' | 'multiAngle' | 'panorama';
```

---

模块 04 分析完。
