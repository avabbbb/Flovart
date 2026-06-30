# 模块 10 — 模型清单

> LibTV 全量模型清单 + Flovart BYOK 适配策略
> 日期: 2026-06-29

---

## 1. LibTV 模型清单

### 1.1 图像模型

| 模型 | 类型 | 说明 |
|------|------|------|
| Lib Image | 自研 | LibTV 默认 |
| LibNavo 2 / Pro | 自研 | 高质量 |
| Seedream 5.0 / 4.5 / 4.0 | 字节 | 高质量文生图 |
| Midjourney V7 / Niji 7 | MJ | 旗舰 + 动漫 |
| Z Image Turbo | 腾讯 | 快速 |
| Qwen Image / Edit | 阿里 | 文生图 + 编辑 |

### 1.2 视频模型

| 模型 | 能力 | 说明 |
|------|------|------|
| Seedance 2.0 | 多模态 12 参考图 | 9图+3视频+3音频, 1080p/15s, 8语言 lip-sync, 合规校验, prompt 优化 |
| HappyHorse 1.0 | | |
| Kling O3 / 3.0 / 2.6 / 2.5 / 2.1 / O1 | 快手 | 多版本 |
| Shot V2 / V2 Pro | | |
| Video 3.1 / 3.1 Fast / 3 / 3 Fast | | |
| Wan 2.6 / 2.5 / 2.2 | 阿里 | |
| Hailuo 2.3 / 02 | 字节 | |
| Vidu Q3 / Q2 | | |
| Pixverse V5.5 / V5 | | |
| OmniHuman 1.5 | 数字人 | |
| MJ Video | Midjourney | |

### 1.3 语言模型

| 模型 | 用途 | 说明 |
|------|------|------|
| CVLM5.5 | 剧本拆解 | LibTV 专有视觉理解 |
| GVLM 3.1 / 3.1 Flash | 剧本拆解 | 轻量版 |
| Qwen3 VL Flash | 通用视觉 | 阿里 |

### 1.4 音频模型

| 模型 | 能力 | 说明 |
|------|------|------|
| Eleven V3 | TTS | |
| Mureka V8 | TTS | |
| Minimax 2.8 | TTS | 300+ 音色 + 音色克隆 |

---

## 2. Flovart 现状

### 2.1 已有 Provider ✅
- Flovart 已有 12+ Provider(aiGateway.ts `DEFAULT_BASE_URLS`)
- BYOK 模式: 用户自带 API Key
- `inferProviderFromModel` 从模型名推断 Provider
- `modelPreference` 全局模型偏好

### 2.2 Gap ❌

| 差距 | 说明 |
|------|------|
| 无 LibTV 专有模型 | Lib Image / LibNavo / CVLM / GVLM 是闭源，无法接入 |
| Seedance 12 参考图协议 | 需 9 图 + 3 视频 + 3 音频 参考输入，Flovart 目前只支持普通参考图 |
| 合规校验 | Seedance 有合规校验步骤 |
| Prompt 优化 | Seedance 有自动 prompt 优化 |
| 音色克隆 | Minimax 300+ 音色 + 克隆，需音色库 UI |
| 模型能力检测 | 不是所有 Provider 支持所有模型 |

---

## 3. 适配策略

### 3.1 BYOK 适配原则

**Flovart 不自己提供模型，只做路由**:
- 用户自带 API Key → Flovart 前端直连 OpenAI 兼容接口
- `inferProviderFromModel` 自动推断 Provider
- 用户可在 `modelPreference` 自定义模型 ID

### 3.2 模型清单注册

```ts
// services/modelCatalog.ts (新建)
export interface ModelCatalogEntry {
  id: string;               // 模型 ID(如 "seedream-5.0")
  provider: string;         // Provider ID(如 "doubao")
  category: 'image' | 'video' | 'language' | 'audio';
  label: string;            // 显示名
  capabilities: string[];   // ['text2image', 'image2image', 'upscale']
  maxReferences?: number;   // 最大参考图数
  referenceTypes?: ('image' | 'video' | 'audio')[];
  complianceCheck?: boolean; // 是否需合规校验
  promptOptimization?: boolean;
  notes?: string;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  // 图像
  { id: 'seedream-5.0', provider: 'doubao', category: 'image', label: 'Seedream 5.0', capabilities: ['text2image', 'image2image'] },
  { id: 'mj-v7', provider: 'midjourney', category: 'image', label: 'Midjourney V7', capabilities: ['text2image'] },
  // 视频
  { id: 'seedance-2.0', provider: 'doubao', category: 'video', label: 'Seedance 2.0', capabilities: ['text2video', 'image2video'], maxReferences: 12, referenceTypes: ['image','video','audio'], complianceCheck: true, promptOptimization: true },
  { id: 'kling-3.0', provider: 'kuaishou', category: 'video', label: 'Kling 3.0', capabilities: ['text2video', 'image2video'], maxReferences: 1 },
  // 语言
  { id: 'qwen3-vl-flash', provider: 'alibaba', category: 'language', label: 'Qwen3 VL Flash', capabilities: ['vision', 'chat'] },
  // 音频
  { id: 'minimax-2.8', provider: 'minimax', category: 'audio', label: 'Minimax 2.8', capabilities: ['tts', 'voice-clone'] },
];
```

### 3.3 Seedance 12 参考图协议(P1)

```ts
// WorkflowGenerationConfig 扩展
export interface SeedanceReferences {
  imageRefs: string[];   // 最多 9 张参考图 nodeId
  videoRefs: string[];   // 最多 3 个参考视频 nodeId
  audioRefs: string[];   // 最多 3 个参考音频 nodeId
}

// 生成时:
// 按顺序注入参考输入(image[0..8] + video[0..2] + audio[0..2])
```

- UI: 视频生成 config 面板，当模型为 Seedance 时显示 12 槽位参考输入

### 3.4 合规校验 + Prompt 优化(P2)
- 模型若 `complianceCheck: true` → 生成前调合规校验接口(若 Provider 支持)
- 模型若 `promptOptimization: true` → 生成前自动调 prompt 优化接口

### 3.5 音色库(P2)
```ts
// services/voiceCatalog.ts
export interface VoicePreset {
  id: string;
  name: string;
  provider: string;
  previewUrl?: string;
}
// Minimax 300+ 音色 + 用户克隆音色
```

---

## 4. 优先级

| 子项 | 优先级 | 理由 |
|------|--------|------|
| 模型清单注册表 | P0 | 基础设施 |
| capability 检测 UI | P0 | 用户体验 |
| Seedance 12 参考图 | P1 | 旗舰视频能力 |
| 合规/prompt 优化 | P2 | Provider 依赖 |
| 音色库 | P2 | 音频生成增强 |
| LibTV 专有模型 | 不可做 | 闭源 |

---

## 5. 风险

1. **LibTV 专有模型不可接入** — Lib Image/LibNavo/CVLM/GVLM 是闭源自研。Flovart 只能用同类开源/商用替代(Seedream/Qwen VL)。
2. **BYOK 下模型质量参差** — 用户自带 Key，模型质量取决于用户选的 Provider。文档需写清。
3. **参考图顺序敏感** — Seedance 12 参考图有顺序语义(9图+3视频+3音频)，顺序错误影响结果。
4. **模型清单维护成本** — 30+ 模型需持续更新。建议从配置文件加载，不硬编码。

---

模块 10 分析完。

---

## 全部 10 模块分析完成

所有模块文档已落盘到 `docs/analysis/libtv-modules/`:
- `00-overview.md` — 总览 + 模块索引 + 阶段建议
- `01-canvas-nodes-workflow.md` — 画布+节点+工作流
- `02-script-node.md` — Script 脚本节点(核心)
- `03-slash-commands.md` — Slash 快捷功能(12+)
- `04-image-tools.md` — 图像工具(全景/多角度/打光/编辑/切分/标注/旋转/分镜组)
- `05-video-tools.md` — 视频工具(高清/解析/剪辑/合成/人声分离/音视频分离)
- `06-director-stage.md` — 导演台(3D构图)
- `07-audio-tools.md` — 音频工具(截取/变速)
- `08-image-generator.md` — 图像生成器(风格库/焦点/镜头聚焦/摄像机)
- `09-video-generator.md` — 视频生成器(主体库/运镜控制)
- `10-model-catalog.md` — 模型清单 + BYOK 适配
