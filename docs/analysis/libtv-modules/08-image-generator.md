# 模块 08 — 图像生成器

> LibTV 图像生成的高级控制: 风格库 / 焦点编辑 / 镜头聚焦 / 摄像机控制
> 日期: 2026-06-29

---

## 1. LibTV 图像生成器功能

### 1.1 风格库
- 分类浏览风格预设(动漫/写实/油画/水彩/赛博朋克/...)
- 搜索风格
- 自定义风格模板(保存 prompt + 参数为模板)
- 选中风格 → 注入到图片生成 prompt

### 1.2 焦点编辑
- 从画布提取元素作为焦点
- 指定画面中重点区域/主体
- 生成时保持焦点元素一致

### 1.3 镜头聚焦
- 在图片上框选特写区域
- 生成该区域的放大特写图

### 1.4 摄像机控制
- 相机型号: Sony Venice / ARRI Alexa / RED / ...
- 镜头: Helios / 广角 / 标准 / 长焦
- 焦距: 24mm / 50mm / 85mm / ...
- 光圈: f/1.8 / f/4 / f/8 / ...
- 注入到 prompt 前缀

---

## 2. Flovart 现状

### 2.1 已有 ✅
| 能力 | 位置 | 状态 |
|------|------|------|
| 图片生成 | `useGeneration.ts` | ✅ |
| 模型选择 | `WorkflowConfigPanel.tsx:70` | ✅ |
| 宽高比/分辨率 | `WorkflowGenerationConfig` | ✅ |

### 2.2 Gap ❌

| LibTV 能力 | Flovart | 差距 |
|-----------|---------|------|
| 风格库 | 无 | 需风格预设库 + 搜索 + 自定义模板 |
| 焦点编辑 | 无 | 需画布元素提取 + 焦点锁定 |
| 镜头聚焦(框选特写) | 无 | 需框选 + 裁取放大 |
| 摄像机控制 | 无 | 需相机/镜头/焦距/光圈字段 |

---

## 3. 实现方案

### 3.1 风格库(P1)

```ts
// 新建 components/workflow/StyleLibrary.tsx
export interface StylePreset {
  id: string;
  name: string;
  category: string;        // 动漫/写实/油画/...
  promptPrefix: string;    // 注入到 prompt 前缀
  previewUrl?: string;     // 预览图
  isCustom?: boolean;      // 用户自定义
}
```

**内置风格预设**(纯 prompt 前缀，无需 AI):
```ts
const BUILTIN_STYLES: StylePreset[] = [
  { id: 'anime', name: '动漫', category: '插画', promptPrefix: 'anime style, cel shading, vibrant colors' },
  { id: 'realistic', name: '写实', category: '摄影', promptPrefix: 'photorealistic, 8k, detailed' },
  { id: 'oil', name: '油画', category: '艺术', promptPrefix: 'oil painting, textured brushstrokes' },
  // ... 20+ 预设
];
```

**自定义模板**:
- 用户保存当前 prompt + 参数 → StylePreset
- store 持久化 `customStyles: StylePreset[]`

**UI**:
- 生成配置面板新增"风格"下拉/弹窗
- 分类标签 + 搜索框 + 预览图网格
- 选中 → promptPrefix 注入到 RichPromptEditor

### 3.2 焦点编辑(P2)
```ts
// WorkflowNodeMetadata 新增
focusElementIds?: string[];  // 焦点元素节点 ID
// 生成时: 焦点元素的 href → 参考图注入
```
- UI: 在图片节点上选"设为焦点" → 其他生成节点可引用该焦点

### 3.3 镜头聚焦(P1)
```ts
// 新建 components/workflow/FocusCropDialog.tsx
// 1. 在图片上框选区域(复用 CropDialog 的选区交互)
// 2. 裁取选区 → 放大 → 图生图补全细节
// 输出: 特写放大图节点
```

### 3.4 摄像机控制(P1)
```ts
// WorkflowGenerationConfig 扩展
export interface CameraParams {
  camera?: string;       // Sony Venice / ARRI Alexa / RED
  lens?: string;         // Helios / 广角 / 标准 / 长焦
  focalLength?: string;  // 24mm / 50mm / 85mm
  aperture?: string;     // f/1.8 / f/4 / f/8
}

export interface WorkflowGenerationConfig {
  // ... 现有
  camera?: CameraParams;
}
```

**UI**: `WorkflowConfigPanel` 新增摄像机字段:
```tsx
<label>相机</label>
<select>{['', 'Sony Venice', 'ARRI Alexa', 'RED', 'Canon EOS', 'Panasonic']}</select>
<label>镜头</label>
<select>{['', 'Helios', '广角', '标准', '长焦', '微距']}</select>
<label>焦距</label>
<Segmented options={['24mm', '35mm', '50mm', '85mm', '135mm']} />
<label>光圈</label>
<Segmented options={['f/1.8', 'f/2.8', 'f/4', 'f/5.6', 'f/8']} />
```

**prompt 注入**:
```ts
// 生成时拼 prompt 前缀
const cameraPrefix = [
  config.camera?.camera,
  config.camera?.lens,
  config.camera?.focalLength,
  config.camera?.aperture,
].filter(Boolean).join(', ');
// finalPrompt = cameraPrefix + ', ' + userPrompt
```

---

## 4. 优先级

| 子项 | 优先级 | 理由 |
|------|--------|------|
| 摄像机控制 | P0 | 纯 prompt 注入，零 AI 成本 |
| 风格库(内置) | P1 | 纯 prompt 前缀，高实用 |
| 自定义风格模板 | P1 | 持久化复用 |
| 镜头聚焦 | P1 | 裁取+图生图 |
| 焦点编辑 | P2 | 需元素提取，复杂 |

---

模块 08 分析完。
