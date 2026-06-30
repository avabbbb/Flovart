# 模块 02 — Script 脚本节点(新版分镜故事板)

> LibTV 核心差异化能力。已拍板: Script 作为 Workflow 第 6 种节点类型
> 日期: 2026-06-29

---

## 1. LibTV Script 节点详述

### 1.1 定位
Script 节点是 LibTV 的"新版分镜故事板"——从剧本到成片的全链路编排器。

### 1.2 工作流程
```
剧本输入 → LLM 拆解 → 资产提取 → 分镜编辑 → 提示词合成 → 批量生图 → 批量生视频
```

### 1.3 各阶段能力

**① 剧本输入**
- 手动输入文本剧本
- 上传参考视频(让 LLM 参考节奏/风格)
- 上传角色设定

**② LLM 拆解(模型: CVLM5.5 / GVLM 3.1)**
- 自动把剧本拆成分镜列表
- 每个分镜: 序号 / 情绪 / 动作 / 台词 / 音效 / 场景描述

**③ 资产提取**
- 从剧本自动提取: 角色 / 场景 / 道具
- 每个资产生成设定图(角色三视图、场景图、道具图)
- 资产可被分镜 @引用
- **改一处自动同步**: 修改角色设定图 → 所有引用该角色的分镜自动更新

**④ 分镜编辑**
- 增删分镜
- 拖拽排序
- 颜色标记(分组/优先级)
- 每个分镜可独立编辑: 情绪/动作/台词/音效/场景

**⑤ 提示词合成**
- 分镜信息 + @引用的资产 → 自动合成完整 prompt
- 可手动微调

**⑥ 批量生图**
- 一键对全部分镜执行图片生成
- 每个分镜生成一张图
- 支持选择图像模型

**⑦ 批量生视频**
- 一键对全部分镜执行视频生成
- 分镜图作首帧
- 支持选择视频模型

### 1.4 资产引用机制
- 资产(角色/场景/道具)有独立 ID
- 分镜通过 `@角色名` / `@场景名` 引用
- 资产设定图更新 → 引用该资产的所有分镜自动重新生成(或标记需更新)

---

## 2. Flovart 现状

### 2.1 完全无 Script 节点 ❌
- `WorkflowNodeType` 只有 5 种，无 `script`
- 无剧本拆解能力
- 无资产提取/引用机制
- 无分镜编辑器
- 无批量生图/生视频编排

### 2.2 可复用基础 ✅
| 基础能力 | 位置 | 复用方式 |
|---------|------|---------|
| 节点创建 | `constants.ts:18` | 新增 script spec |
| 批量生成 | `useGeneration.ts` handleGenerate | 已支持 batchId |
| 节点连线 | `ops.ts` | script → image/video 连线 |
| Agent Chat | `Chat.tsx` 13 工具 | LLM 拆解可走 Agent Chat tool-calling |
| RichPromptEditor | 已有 @mention | 资产 @引用可复用 mention 机制 |
| modelPreference | 已有 | CVLM5.5/GVLM 需新增到语言模型列表 |

---

## 3. 实现方案

### 3.1 数据结构

```ts
// types.ts 扩展
export type WorkflowNodeType = 'image' | 'text' | 'video' | 'audio' | 'config' | 'script';

// Script 节点 metadata
export interface ScriptAsset {
  id: string;
  kind: 'character' | 'scene' | 'prop';
  name: string;
  description?: string;
  settingImageNodeId?: string;  // 关联的图片节点(设定图)
}

export interface ScriptShot {
  id: string;
  index: number;
  emotion?: string;       // 情绪
  action?: string;        // 动作
  dialogue?: string;      // 台词
  sfx?: string;           // 音效
  scene?: string;         // 场景描述
  promptOverride?: string; // 手动微调的 prompt
  colorTag?: string;      // 颜色标记
  imageNodeId?: string;   // 生成的分镜图节点
  videoNodeId?: string;   // 生成的分镜视频节点
  status?: 'idle' | 'loading' | 'success' | 'error';
}

export interface ScriptBreakdown {
  assets: ScriptAsset[];
  shots: ScriptShot[];
  sourceText?: string;      // 原始剧本
  referenceVideoNodeId?: string;  // 参考视频节点
  modelId?: string;         // 拆解用的 LLM 模型
}

// WorkflowNodeMetadata 新增
export interface WorkflowNodeMetadata {
  // ... 现有字段
  scriptBreakdown?: ScriptBreakdown;
}
```

### 3.2 节点常量
```ts
// constants.ts 新增
script: {
  title: '脚本',
  width: 480,
  height: 560,
  metadata: { status: 'idle', scriptBreakdown: { assets: [], shots: [] } },
},
```

### 3.3 剧本拆解(走 Agent Chat tool-calling)

**方案**: 新增 Chat 工具 `script_breakdown`
```ts
// Chat.tsx TOOLS 新增
{
  type: 'function',
  function: {
    name: 'script_breakdown',
    description: '把剧本文本拆解成分镜列表和资产列表',
    parameters: {
      type: 'object',
      properties: {
        scriptText: { type: 'string', description: '剧本原文' },
        modelId: { type: 'string', description: 'LLM 模型 ID' },
      },
      required: ['scriptText'],
    },
  },
}
```

**executeTool 新增 case**:
```ts
case 'script_breakdown': {
  // 1. 调 CVLM5.5/GVLM 拆解
  // 2. 返回 { assets: ScriptAsset[], shots: ScriptShot[] }
  // 3. 创建 script 节点，写入 scriptBreakdown
}
```

### 3.4 分镜编辑器 UI

新建 `components/workflow/ScriptNodeEditor.tsx`:
- **资产区**: 左侧栏列出角色/场景/道具，每个资产可关联设定图节点
- **分镜列表**: 右侧主区，每行一个分镜
  - 序号 / 情绪 / 动作 / 台词 / 音效 / 场景
  - 拖拽排序(react-beautiful-dnd 或 dnd-kit)
  - 增删按钮
  - 颜色标记(Segmented 选色)
  - @引用资产(复用 RichPromptEditor mention)
- **底部操作栏**:
  - "批量生图" → 遍历 shots，每个 shot 创建 image 节点 + 连线 + run_generation
  - "批量生视频" → 遍历 shots，每个 shot 创建 video 节点 + 连线 + run_generation

### 3.5 资产引用自动同步
- 资产设定图节点更新 → 遍历引用该资产的 shots → 标记 `status: 'stale'`
- 用户可选择"重新生成"或"忽略"

### 3.6 批量生图/生视频编排
```ts
// ScriptNodeEditor.tsx
function batchGenerateImages(scriptNodeId: string, shots: ScriptShot[]) {
  for (const shot of shots) {
    // 1. 合成 prompt: shot.scene + shot.action + @资产设定图
    // 2. 创建 image 节点(位置: script 节点右侧排列)
    // 3. 连线: script → image
    // 4. shot.imageNodeId = newNode.id
    // 5. run_generation(imageNodeId)
  }
}
```

---

## 4. 连线语义

```
script 节点 ──→ image 节点(分镜图)
script 节点 ──→ video 节点(分镜视频)
image 节点(设定图) ──→ script 节点(资产输入)
video 节点(参考) ──→ script 节点(参考输入)
```

- script → image/video: script 的 shot.prompt → 下游生成
- image(设定图) → script: 作为资产 settingImageNodeId

---

## 5. 优先级

| 子项 | 优先级 | 理由 |
|------|--------|------|
| script 节点类型 + 数据结构 | P0 | 基础 |
| 剧本拆解(script_breakdown 工具) | P0 | 核心入口 |
| 分镜编辑器 UI | P0 | 核心交互 |
| 批量生图 | P0 | 核心价值 |
| 批量生视频 | P0 | 核心价值 |
| 资产提取 + @引用 | P1 | 增强一致性 |
| 资产自动同步 | P1 | 体验优化 |
| 颜色标记 + 拖拽排序 | P1 | 体验优化 |
| 参考视频输入 | P2 | 锦上添花 |

---

## 6. 风险

1. **LLM 拆解质量决定上限** — CVLM5.5/GVLM 3.1 是 LibTV 专有模型，Flovart BYOK 下用户可能用弱模型。需在 UI 提示"建议使用强视觉理解模型"。
2. **批量生成 token 消耗大** — 25 个分镜 × 生成 = 25 次调用。需进度条 + 失败重试 + 部分成功展示。
3. **资产自动同步可能引发蝴蝶效应** — 改一处角色图触发 25 个分镜重新生成。需用户确认弹窗。
4. **Script 节点 UI 复杂度高** — 分镜编辑器是独立大型组件，需单独拆 `ScriptNodeEditor.tsx`，不计入 Excalidraw 侧。

---

模块 02 分析完。
