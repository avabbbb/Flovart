# 模块 05 — 视频工具

> LibTV 视频节点上的完整工具集，Flovart 几乎全缺
> 日期: 2026-06-29

---

## 1. LibTV 视频工具清单

### 1.1 高清(超分)
- 2 倍 / 4 倍 / 6 倍超分
- 帧率提升: 30 / 60 / 90 fps

### 1.2 解析(分镜拆解)
- 输入: 1 个视频
- 输出: 分镜拆解表格
- 自动识别场景切换点，列出每个分镜:
  - 序号 / 时间码 / 场景描述 / 截图

### 1.3 剪辑
- 片段裁取: 选开始/结束时间，裁取子片段
- 快捷键辅助: I(设入点) / O(设出点) / 空格(播放暂停)
- 输出: 裁取后的子视频

### 1.4 合成(拼接)
- 多片段拼接
- 时间轴编辑
- 音轨叠加
- 最长 20 分钟
- 输出: 拼接后的成片

### 1.5 人声分离
- 输入: 带人声的音频/视频
- 输出: 纯人声 + 纯伴奏(或背景音)

### 1.6 音视频分离
- 输入: 视频
- 输出: 纯视频轨(静音) + 纯音频轨

---

## 2. Flovart 现状

### 2.1 完全无视频工具 ❌
- `WorkflowImageToolKind` 只覆盖图片(crop/filter/upscale/removeBg/outpaint/mask/split)
- 无视频超分、解析、剪辑、合成、人声分离、音视频分离

### 2.2 可复用基础
| 基础 | 位置 | 复用 |
|------|------|------|
| 视频节点 | `types.ts:3` video 类型 | 已有 |
| 节点工具栏 | `WorkflowNodeToolbar.tsx` | 新增视频工具按钮 |
| 工具弹窗模式 | `WorkflowImageToolDialogs.tsx` | 新建 `WorkflowVideoToolDialogs.tsx` |

---

## 3. 实现方案

### 3.1 视频工具类型
```ts
// 新建 components/workflow/WorkflowVideoToolDialogs.tsx
export type WorkflowVideoToolKind =
  | 'upscale'      // 高清超分
  | 'analyze'      // 分镜拆解
  | 'trim'         // 剪辑
  | 'merge'        // 合成拼接
  | 'vocal-split'  // 人声分离
  | 'av-split';    // 音视频分离

export interface WorkflowVideoToolHandlers {
  upscale?: (id: string) => void;
  analyze?: (id: string) => void;
  trim?: (id: string) => void;
  merge?: (ids: string[]) => void;
  vocalSplit?: (id: string) => void;
  avSplit?: (id: string) => void;
}
```

### 3.2 高清超分(P1)
```ts
// services/videoTools.ts
// 调视频超分 API(需 Provider 支持)
// 参数: scale(2/4/6) + fps(30/60/90)
// 输出: 超分后视频节点
```
- `UpscaleDialog`: 选倍率 + 帧率
- 调 video generation API 的 upscale 模式(若 Provider 支持)

### 3.3 分镜拆解(P1)
```ts
// services/videoAnalyze.ts
// 方案 A: 调 LLM(视觉模型)分析视频 → 返回分镜列表
// 方案 B: 前端 ffmpeg.wasm 检测场景切换 + 截图
// 输出: text 节点(分镜表格) + N 个 image 节点(分镜截图)
```
- `AnalyzeDialog`: 显示进度 + 结果表格
- 每个分镜: 时间码 / 场景描述 / 截图节点

### 3.4 剪辑(P0 — 最实用)
```ts
// 方案: ffmpeg.wasm 裁取子片段
// services/videoTrim.ts
export async function trimVideo(url: string, start: number, end: number): Promise<string> {
  // ffmpeg.wasm -ss {start} -to {end} -c copy
}
```
- `TrimDialog`:
  - 视频预览播放器
  - 时间轴拖拽选区
  - 快捷键: I(入点) / O(出点) / 空格(播放)
  - 输出: 裁取后的视频节点

### 3.5 合成拼接(P1)
```ts
// services/videoMerge.ts
// 方案: ffmpeg.wasm concat
export async function mergeVideos(urls: string[], audioTrack?: string): Promise<string> {
  // ffmpeg concat demuxer
}
```
- `MergeDialog`:
  - 选中多个 video 节点
  - 时间轴排列(拖拽排序)
  - 可选叠加音频轨(选 audio 节点)
  - 最长 20 分钟
  - 输出: 拼接成片节点

### 3.6 人声分离(P2)
```ts
// 需 AI 模型(如 Demucs / Spleeter API)
// 输出: 2 个 audio 节点(人声 + 伴奏)
```

### 3.7 音视频分离(P0 — 简单)
```ts
// ffmpeg.wasm 提取音轨
export async function splitAudioVideo(url: string): Promise<{ video: string; audio: string }> {
  // ffmpeg -i input -an video_only.mp4
  // ffmpeg -i input -vn audio_only.mp3
}
```
- 输出: 1 个 video 节点(静音) + 1 个 audio 节点

---

## 4. ffmpeg.wasm 集成

视频工具大量依赖 ffmpeg，方案:

```ts
// services/ffmpegClient.ts
// 使用 @ffmpeg/ffmpeg + @ffmpeg/util
let ffmpeg: FFmpeg;
export async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpeg) {
    ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: '/ffmpeg-core/ffmpeg-core.js',
      wasmURL: '/ffmpeg-core/ffmpeg-core.wasm',
    });
  }
  return ffmpeg;
}
```

**注意**:
- ffmpeg.wasm 体积大(~30MB)，需按需加载
- 浏览器需 SharedArrayBuffer(COI headers)
- 若浏览器不支持，降级到服务端处理(需后端)

---

## 5. 视频工具栏扩展

`WorkflowNodeToolbar.tsx` video 类型新增:
```ts
node?.type === 'video' && mediaUrl && imageTools && [
  { key: 'vUpscale', label: '高清超分', icon: <ZoomIn />, onClick: () => videoTools.upscale?.(node.id) },
  { key: 'vAnalyze', label: '分镜拆解', icon: <ScanText />, onClick: () => videoTools.analyze?.(node.id) },
  { key: 'vTrim', label: '剪辑', icon: <Scissors />, onClick: () => videoTools.trim?.(node.id) },
  { key: 'vMerge', label: '合成拼接', icon: <Combine />, onClick: () => videoTools.merge?.(selectedMedia.map(n=>n.id)) },
  { key: 'vVocalSplit', label: '人声分离', icon: <MicOff />, onClick: () => videoTools.vocalSplit?.(node.id) },
  { key: 'vAvSplit', label: '音视频分离', icon: <Unplug />, onClick: () => videoTools.avSplit?.(node.id) },
]
```

---

## 6. 优先级

| 工具 | 优先级 | 理由 |
|------|--------|------|
| 音视频分离 | P0 | ffmpeg 纯前端，零 AI 成本 |
| 剪辑(裁取) | P0 | 最高频视频操作 |
| 合成拼接 | P1 | 成片必需 |
| 高清超分 | P1 | 需 Provider 支持 |
| 分镜拆解 | P1 | 需 LLM 或场景检测 |
| 人声分离 | P2 | 需专用 AI 模型 |

---

## 7. 风险

1. **ffmpeg.wasm 浏览器兼容** — 需 SharedArrayBuffer，部署需 COI headers(Cross-Origin-Embedder-Policy + Cross-Origin-Opener-Policy)。Next.js 需配 headers。
2. **大视频内存** — 20 分钟视频 ffmpeg.wasm 可能 OOM。需限制处理时长或分块。
3. **视频超分 Provider 支持** — 不是所有 Provider 都支持视频超分，需 capability 检测。

---

模块 05 分析完。
