# 模块 09 — 视频生成器

> LibTV 视频生成的高级控制: 主体库 / 运镜控制
> 日期: 2026-06-29

---

## 1. LibTV 视频生成器功能

### 1.1 主体库
- 用图片或视频创建"主体"
- 主体包含:
  - 设定图(外观)
  - 音色(配音用)
  - 智能补全视角(从单图生成多角度)
- 后续视频生成可引用主体，保持角色一致
- 主体可跨项目复用

### 1.2 运镜控制
- 20+ 运镜预设:
  - push(推进) / pull(拉远) / pan(平移) / tilt(俯仰) / dolly(移动)
  - orbit(环绕) / crane(升降) / handheld(手持) / ...
- 自定义运镜(参数化)
- 收藏运镜(保存自定义预设)
- 注入到视频生成 prompt

---

## 2. Flovart 现状

### 2.1 已有 ✅
| 能力 | 位置 | 状态 |
|------|------|------|
| 视频生成 | `useGeneration.ts` | ✅ |
| 视频模型选择 | `WorkflowConfigPanel.tsx` | ✅ |
| 参考图/视频 | mentionedNodeIds | ✅ |

### 2.2 Gap ❌

| LibTV 能力 | Flovart | 差距 |
|-----------|---------|------|
| 主体库 | 无 | 需主体概念 + 跨项目复用 |
| 主体音色 | 无 | 需关联音频节点 |
| 智能补全视角 | 无 | 需多角度生成(同模块04) |
| 运镜预设 | 无 | 需运镜枚举 + prompt 注入 |
| 自定义运镜 | 无 | 需参数化运镜 + 收藏 |

---

## 3. 实现方案

### 3.1 主体库(P1)

```ts
// types.ts 新增(或在 store 层)
export interface VideoSubject {
  id: string;
  name: string;
  settingImageNodeId?: string;  // 设定图(关联 image 节点)
  settingImageUrl?: string;     // 或直接存 URL
  voiceAudioNodeId?: string;    // 音色(关联 audio 节点)
  voiceUrl?: string;
  multiAngleImageIds?: string[]; // 智能补全的多角度图
  createdAt: string;
}
```

**主体存储**:
- 全局 store(跨项目): `useSubjectStore`(Zustand + localforage)
- 或存在 Workflow store 的 project 级 + 全局复用

**创建主体流程**:
1. 选中 image 节点 → "创建为主体"
2. 弹窗输入名称 + 可选关联音色(audio 节点)
3. 可选"智能补全视角" → 调多角度生成(模块04) → 生成前/侧/后 3 视图
4. 保存到主体库

**引用主体**:
- 视频生成时，config 面板新增"主体"下拉
- 选中主体 → settingImage 作为参考图注入 → 保持角色一致

**UI**:
- 新建 `components/workflow/SubjectLibrary.tsx`
- 左侧栏新增"主体库"区
- 卡片展示: 名称 + 设定图缩略图 + 音色标识

### 3.2 运镜控制(P0)

```ts
// constants.ts 新增
export interface CameraMovement {
  id: string;
  name: string;
  description: string;
  promptKeyword: string;     // 注入到 prompt 的关键词
  isCustom?: boolean;
}

export const CAMERA_MOVEMENTS: CameraMovement[] = [
  { id: 'push', name: '推进', description: '镜头向主体推进', promptKeyword: 'camera push in' },
  { id: 'pull', name: '拉远', description: '镜头远离主体', promptKeyword: 'camera pull out' },
  { id: 'pan', name: '平移', description: '水平移动', promptKeyword: 'camera pan' },
  { id: 'tilt', name: '俯仰', description: '垂直俯仰', promptKeyword: 'camera tilt' },
  { id: 'dolly', name: '移动', description: '跟拍移动', promptKeyword: 'camera dolly' },
  { id: 'orbit', name: '环绕', description: '环绕主体', promptKeyword: 'camera orbit' },
  { id: 'crane', name: '升降', description: '垂直升降', promptKeyword: 'camera crane' },
  { id: 'handheld', name: '手持', description: '手持晃动', promptKeyword: 'handheld camera' },
  { id: 'static', name: '固定', description: '固定机位', promptKeyword: 'static camera' },
  { id: 'zoom-in', name: '变焦推进', description: '光学变焦放大', promptKeyword: 'zoom in' },
  { id: 'zoom-out', name: '变焦拉远', description: '光学变焦缩小', promptKeyword: 'zoom out' },
  { id: 'whip-pan', name: '甩镜头', description: '快速平移', promptKeyword: 'whip pan' },
  { id: 'dutch', name: '荷兰角', description: '倾斜构图', promptKeyword: 'dutch angle' },
  { id: 'fpv', name: '第一人称', description: 'FPV穿越', promptKeyword: 'FPV drone' },
  { id: 'aerial', name: '航拍', description: '空中俯拍', promptKeyword: 'aerial shot' },
  { id: 'tracking', name: '跟随', description: '跟拍主体', promptKeyword: 'tracking shot' },
  { id: 'establishing', name: '建立镜头', description: '全景建立', promptKeyword: 'establishing shot' },
  { id: 'close-up', name: '特写', description: '近景特写', promptKeyword: 'close-up shot' },
  { id: 'over-shoulder', name: '过肩', description: '过肩镜头', promptKeyword: 'over the shoulder' },
  { id: 'low-angle', name: '仰拍', description: '低角度仰视', promptKeyword: 'low angle shot' },
  { id: 'high-angle', name: '俯拍', description: '高角度俯视', promptKeyword: 'high angle shot' },
];
```

**WorkflowGenerationConfig 扩展**:
```ts
export interface WorkflowGenerationConfig {
  // ... 现有
  cameraMovement?: string;        // 运镜 ID
  customMovement?: string;        // 自定义运镜描述
}
```

**UI**: `WorkflowConfigPanel` video 模式新增:
```tsx
<label>运镜</label>
<select>
  <option value="">无</option>
  {CAMERA_MOVEMENTS.map(m => <option value={m.id}>{m.name}</option>)}
</select>
// 或用弹窗网格选择(带描述)
```

**prompt 注入**:
```ts
const movement = CAMERA_MOVEMENTS.find(m => m.id === config.cameraMovement);
const movementKeyword = movement?.promptKeyword || config.customMovement || '';
// finalPrompt = movementKeyword + ', ' + userPrompt
```

### 3.3 收藏运镜(P2)
- 用户自定义运镜描述 → 保存为收藏
- store 持久化 `customMovements: CameraMovement[]`

---

## 4. 优先级

| 子项 | 优先级 | 理由 |
|------|--------|------|
| 运镜预设(20+) | P0 | 纯 prompt 注入，零成本 |
| 运镜 UI(下拉/网格) | P0 | |
| 主体库(创建/引用) | P1 | 角色一致性核心 |
| 智能补全视角 | P1 | 依赖模块04多角度 |
| 主体音色关联 | P2 | 需音频生成 |
| 收藏运镜 | P2 | 体验优化 |

---

模块 09 分析完。
