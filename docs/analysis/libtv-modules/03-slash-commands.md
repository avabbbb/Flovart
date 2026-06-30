# 模块 03 — Slash 快捷功能(12+)

> LibTV 的"/"快捷命令面板，提供 12+ 导演级专业能力
> 日期: 2026-06-29

---

## 1. LibTV Slash 功能清单

在画布输入 `/` 触发快捷功能菜单，包含:

| # | 功能 | 输入 | 输出 | 说明 |
|---|------|------|------|------|
| 1 | 多机位九宫格 | 1 张图 | 9 宫格图(9 个角度/机位) | 3×3 网格，不同机位视角 |
| 2 | 剧情推演四宫格 | 1 段剧情 | 4 格剧情演绎图 | 2×2 网格，按时间线推演 |
| 3 | 25宫格连贯分镜 | 1 句描述/剧本 | 5×5 网格图 | 25 帧连贯分镜 |
| 4 | 电影级光影矫正 | 1 张图 | 光影修复后图 | 一键修复不稳定光线 |
| 5 | 角色三视图生成 | 1 张角色图 | 前/侧/后 3 视图 | 多视图 LoRA/ControlNet |
| 6 | 画面推演+N秒 | 1 张图 + N | N 秒后的下一帧 | 图生视频 N 秒 |
| 7 | 画面推演-N秒 | 1 张图 + N | N 秒前的上一帧 | 反向推演 |
| 8 | 角色设定图 | 描述 | 角色设定图 | 角色正/侧/背 + 表情 |
| 9 | 故事板 | 描述/剧本 | 分镜网格图 | 通用分镜 |
| 10 | 调度故事板 | 描述/剧本 | 带调度的分镜 | 含机位/运动方向 |
| 11 | 人像质感调节 | 1 张人像 | 质感增强图 | 皮肤/光影/细节 |
| 12 | 情绪调节 | 1 张人像 | 25 表情变体 | 25 种表情切换 |
| 13 | 情绪调节(多人) | 多人图 + 选人 | 选中角色表情变体 | 多人图中选特定角色 |

---

## 2. Flovart 现状

### 2.1 无 Slash 命令面板 ❌
- 画布上无 `/` 快捷菜单
- 无上述 12+ 专业能力中的任何一个

### 2.2 可复用基础 ✅
| 基础 | 位置 | 复用 |
|------|------|------|
| handleGenerate | `useGeneration.ts:663` | 已支持批量生成 |
| batchId | `types.ts:76` | 批量结果分组 |
| 图片节点 | 已有 | 网格图用 image 节点承载 |
| PromptBar | 已有 | 输入入口 |

---

## 3. 实现方案

### 3.1 Slash 命令面板 UI

新建 `components/workflow/SlashMenu.tsx`:
- 在 Workflow 画布输入 `/` 触发
- 弹出命令列表(类似 VSCode slash command)
- 选中命令 → 弹参数面板 → 确认执行

```ts
export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  category: 'storyboard' | 'character' | 'camera' | 'enhance';
  params?: SlashCommandParam[];
  execute: (params: Record<string, unknown>, sourceNodeId?: string) => void;
}
```

### 3.2 各命令实现思路

**① 多机位九宫格(3×3)**
```ts
// 调 9 次图生图，prompt 前缀不同机位描述
const CAMERA_ANGLES = ['正面', '左侧45°', '右侧45°', '左侧90°', '右侧90°', '俯视', '仰视', '背面', '特写'];
// 9 个 image 节点，batchId 分组，3×3 排列位置
// 可选: 拼成一张大图(9 宫格拼图)
```

**② 剧情推演四宫格(2×2)**
```ts
// 4 次文生图，prompt 分段推演
// "第1幕: ... 第2幕: ... 第3幕: ... 第4幕: ..."
```

**③ 25宫格连贯分镜(5×5)**
```ts
// 25 次文生图，LLM 先把描述拆成 25 个分镜 prompt
// 5×5 排列，可拼成大图
```

**④ 电影级光影矫正**
```ts
// 图生图，prompt: "cinematic lighting, fix uneven light, professional color grading"
// 调图像编辑模型
```

**⑤ 角色三视图**
```ts
// 3 次图生图，prompt 前缀: "front view" / "side view" / "back view"
// 3 个 image 节点横排
```

**⑥ 画面推演+N秒**
```ts
// 图生视频，duration = N 秒
// prompt: "continue the scene, N seconds later"
```

**⑦ 画面推演-N秒**
```ts
// 图生视频(反向)，或调图像模型 prompt: "N seconds before, previous frame"
```

**⑧-⑩ 故事板/调度故事板**
```ts
// LLM 拆描述 → N 个分镜 prompt → 批量文生图
// 调度版额外加: camera movement / blocking notes
```

**⑪ 人像质感调节**
```ts
// 图生图，prompt: "enhance portrait quality, skin texture, professional lighting"
```

**⑫ 情绪调节(25 表情)**
```ts
// 25 次图生图，25 种表情 prompt
// "happy", "sad", "angry", "surprised", ... 25 种
```

**⑬ 情绪调节(多人选人)**
```ts
// 先识别多人图中的人(可让用户框选)
// 对选中角色应用表情变体
```

### 3.3 网格拼图服务

新建 `services/gridComposer.ts`:
```ts
export function composeGrid(images: string[], cols: number): Promise<string> {
  // canvas 拼接，返回 dataURL
}
```
- 9 宫格: 3 cols
- 25 宫格: 5 cols
- 四宫格: 2 cols

### 3.4 位置排列

批量生成时节点的画布位置:
```ts
function gridPositions(origin: WorkflowPoint, cols: number, count: number, gap = 360): WorkflowPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    x: origin.x + (i % cols) * gap,
    y: origin.y + Math.floor(i / cols) * gap,
  }));
}
```

---

## 4. 优先级

| 命令 | 优先级 | 理由 |
|------|--------|------|
| Slash 面板 UI | P0 | 入口 |
| 多机位九宫格 | P1 | 高频 |
| 角色三视图 | P1 | 角色一致性核心 |
| 25宫格分镜 | P1 | 分镜核心 |
| 电影级光影矫正 | P1 | 常用修图 |
| 剧情推演四宫格 | P2 | 低频 |
| 画面推演±N秒 | P2 | 需视频生成 |
| 故事板/调度故事板 | P2 | Script 节点已覆盖类似 |
| 人像质感/情绪调节 | P2 | 修图增强 |

---

## 5. 风险

1. **25 次生成 token 消耗** — 需进度条 + 并发控制(不要 25 个同时打)
2. **网格拼图可能不是用户要的** — LibTV 似乎是拼成一张大图，Flovart 先做节点排列，拼图作为可选
3. **情绪调节 25 表情需要表情清单** — 标准化 25 种表情枚举

---

模块 03 分析完。
