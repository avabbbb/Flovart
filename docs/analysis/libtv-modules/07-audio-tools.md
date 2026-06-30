# 模块 07 — 音频工具

> LibTV 音频节点上的工具集
> 日期: 2026-06-29

---

## 1. LibTV 音频工具清单

### 1.1 截取
- 输入: 1 个音频
- 选开始/结束时间
- 输出: 裁取后的音频片段

### 1.2 变速
- 输入: 1 个音频
- 速度倍率: 0.5x / 0.75x / 1.25x / 1.5x / 2x
- 输出: 变速后音频

---

## 2. Flovart 现状

### 2.1 无音频工具 ❌
- `WorkflowImageToolKind` 无音频工具
- audio 节点只做参考输入，无编辑能力

### 2.2 可复用基础
| 基础 | 位置 | 复用 |
|------|------|------|
| 音频节点 | `types.ts:3` audio | 已有 |
| ffmpeg.wasm | 模块05已规划 | 音频处理复用 |

---

## 3. 实现方案

### 3.1 音频工具类型
```ts
// 新建 components/workflow/WorkflowAudioToolDialogs.tsx
export type WorkflowAudioToolKind = 'trim' | 'speed';

export interface WorkflowAudioToolHandlers {
  trim?: (id: string) => void;
  speed?: (id: string) => void;
}
```

### 3.2 截取(P0)
```ts
// services/audioTools.ts (复用 ffmpeg.wasm)
export async function trimAudio(url: string, start: number, end: number): Promise<string> {
  const ff = await getFFmpeg();
  // -ss {start} -to {end} -c copy
}
```
- `AudioTrimDialog`:
  - 波形预览(可用 wavesurfer.js)
  - 拖拽选区
  - 播放试听

### 3.3 变速(P0)
```ts
export async function changeSpeed(url: string, rate: number): Promise<string> {
  const ff = await getFFmpeg();
  // -filter:a "atempo={rate}"
  // 注意: atempo 范围 0.5-2.0，超出需链式
}
```
- `AudioSpeedDialog`:
  - Segmented 选倍率
  - 试听

### 3.4 波形预览
```ts
// 可选: wavesurfer.js
// 或简化: canvas 绘制 AudioContext 解码波形
```

---

## 4. 优先级

| 工具 | 优先级 | 理由 |
|------|--------|------|
| 截取 | P0 | 高频，ffmpeg 纯前端 |
| 变速 | P0 | 简单，ffmpeg 纯前端 |
| 波形预览 | P1 | 体验优化 |

---

## 5. 风险

- **ffmpeg.wasm 依赖** — 与模块05视频工具共用 ffmpeg 实例，加载一次即可
- **音频格式** — 需支持 mp3/wav/aac/m4a 常见格式

---

模块 07 分析完。
