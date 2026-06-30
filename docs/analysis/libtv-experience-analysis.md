# LibTV 体验 / 节点 / Agent Skill 协议分析

> 分析对象: LibLib.tv 平台 (闭源) + `libtv-labs/libtv-skills` (MIT)
> 分析目的: 为 Flovart Workflow 重构提供节点模型、专业控制能力清单与 Agent Skill 协议范本
> 事实来源: 官方 SKILL.md 原文 + 多篇 2026-03/05 一手评测 + 集成公告,逐字核对
> 分析日期: 2026-06-29

---

## 1. 结论前置

1. **LibTV 的产品力不在画布或节点流,在"专业控制能力 + Agent Skill 双入口"**。无限画布和 5 类节点是骨架,真正卖的是 20+ 导演级控制函数(角色三视图、9 宫格、25 帧分镜、摄影机/光线、关键帧拼成片)和"人类/Agent 同权"的双入口设计。
2. **Agent Skill 协议范本极简**:5 个 Python 脚本,纯标准库,4 个 REST 端点(`POST /openapi/session`、`GET /openapi/session/:id`、`POST /openapi/session/change-project`、`POST /openapi/file/upload`),Authorization Bearer 鉴权,8 秒轮询 + 3 分钟超时。这是 Flovart 重建 Agent Skills 的最小可行范本。
3. **核心反直觉原则**(SKILL.md 原文):**用户侧 Agent 不做创作,只做传话**。不要替用户扩写/润色/翻译 prompt,不要自行拆解任务,不要编镜头描述。后端有专门的 Agent 负责理解需求/拆分镜/编排工作流/选模型/写 prompt。用户侧越俎代庖只会降低生成质量。
4. **LibTV 不开源核心**。能抄的只有 `libtv-skills` 的协议层(MIT)和体验层的字段结构(从评测推断);20+ 专业控制函数的实际实现是黑盒,Flovart 必须自己写后端能力。
5. **LibTV 视频生成器是工作流主出口**。Seedance 2.0(12 路参考:9 图 + 3 视频 + 3 音频,1080p/15s,8+ 语言 lip-sync)、Kling 3.0/O3、Wan 2.6、Vidu、Pixverse 等 30+ 模型。Flovart 已有 12+ Provider,需补齐的是这些模型背后的"参考图顺序注入"协议,不是模型本身。

---

## 2. 平台架构与双入口设计

### 2.1 双入口哲学(原话)

> "LibTV did not suddenly integrate Agents; rather, after testing, running, and refining these capabilities in previous stages, the team naturally extended them into the video creation scenario."
>
> "LibTV opened two doors from the start: one facing an infinite canvas for humans, and another offering Skill interfaces for Agents. Thus, humans are responsible for judgment and aesthetics, Agents handle execution and expansion, and the community manages flow and evolution."

**人类入口**:www.liblib.tv/canvas,无限画布 + 节点流 + 20+ 专业控制面板,导演/动画师/内容创作者手动精调。
**Agent 入口**:`libtv-skills` 包,通过 OpenClaw / KimiClaw / 任意支持 SKILL 规范的 Agent 调用,一句话自动跑全链路。

**关键设计原则**:两条入口最终落到同一套 OpenAPI。Agent 不能调任何人类不能调的端点,反之亦然。这避免了"Agent 专用接口"分裂。

### 2.2 5 类基础节点

| 节点类型 | 承载内容 | 输入方式 |
|---------|---------|---------|
| 📝 文本节点 | 文本信息 | 手动输入 / LLM 生成 |
| 🖼️ 图片节点 | 单张图片 | 上传 / 图像模型生成 |
| 🎥 视频节点 | 单个视频 | 上传 / 视频模型生成 |
| 🎵 音频节点 | 单个音频 | 上传 / 音频模型生成 |
| 🎬 脚本节点 | 生成脚本 + 批量分镜 | 上传剧本 / 角色 / 参考视频 |

**双击空白处** → 添加节点 → 选择类型(含"故事脚本、角色三视图、音视频生成"等模板)。节点可拖拽、复制、连线、自由放置,构建项目空间结构。

### 2.3 节点连线语义

LibTV 官方描述:"通过连线方式自由搭建任务工作流,方便复杂任务一键自动执行。"

**推断语义**(从评测):
- `脚本节点 → 文本节点` :脚本生成台词文本
- `文本节点 → 图片节点` :文本作为 prompt 生成图
- `图片节点(角色) → 图片节点(分镜)` :角色图作为参考生成分镜图
- `图片节点(分镜) → 视频节点` :分镜图作为首帧生成视频
- `音频节点 → 视频节点` :音频作为参考生成带音视频
- `脚本节点 → 视频节点` :脚本直接驱动批量视频生成

这与 basketikun/infinite-canvas 的"config 节点聚合参数 + 上游节点作参考"是同构的。Flovart 应统一用 basketikun 的 `config` 节点范式承载 LibTV 的连线语义。

---

## 3. 20+ 专业控制能力清单

> LibTV 官方宣传 "20+ 独家 AI 能力",公开评测明确点名的如下。Flovart 必须自己实现,LibTV 不开源。

### 3.1 角色一致性

| 能力 | 输入 | 输出 | 实现思路 |
|------|------|------|---------|
| **角色三视图生成** | 1 张角色图 | 前/侧/后 3 视图 | 调多视图 LoRA 或 ControlNet multi-view |
| **360 度角度呈现** | 1 张角色图 | 多角度网格图 | 同上,9 宫格变体 |
| **角色锚定(Anchor First)** | 角色三视图 | 后续所有帧锁定外观 | 后续生成把三视图作参考图强制注入 |

### 3.2 分镜与故事板

| 能力 | 输入 | 输出 |
|------|------|------|
| **9 帧分镜网格** | 1 句描述 / 1 段剧本 | 3×3 网格图 |
| **25 帧分镜大爆炸** | 1 句描述 / 1 段剧本 | 5×5 网格图 |
| **剧情推演四格** | 1 段剧情 | 4 格剧情演绎图 |
| **场景预测 3 秒后** | 1 张图 | 3 秒后的下一帧图 |
| **场景预测 5 秒前** | 1 张图 | 5 秒前的上一帧图 |

### 3.3 摄影机与光线

| 能力 | 字段 | 选项 |
|------|------|------|
| **摄影机型号** | camera | Sony Venice / ARRI Alexa / RED 等 |
| **镜头** | lens | Helios / 广角 / 标准 / 长焦 |
| **焦距** | focalLength | 24mm / 50mm / 85mm 等 |
| **光圈** | aperture | f/1.8 / f/4 / f/8 等 |
| **运镜** | cameraMove | push / pull / pan / tilt / dolly |
| **电影级光影校正** | lighting | 一键修复不稳定光线 |

### 3.4 视频工具

| 能力 | 输出 |
|------|------|
| 视频超分 | 2x / 4x / 6x |
| 帧率提升 | 30 / 60 / 90 fps |
| 视频拆帧 | 帧序列 |
| 基础剪辑 | 裁剪片段 |
| 关键帧拼成片 | 多段视频 → 最终成片 |

### 3.5 编辑能力

| 能力 | 输入 | 输出 |
|------|------|------|
| 局部修改 | 视频 + 区域描述 | 修改后视频 |
| 元素替换 | 视频 + "把 X 换成 Y" | 替换后视频 |
| 风格迁移 | 视频 + 风格图 | 转绘视频 |
| 视频续写延长 | 视频 | 续作视频 |
| 复刻视频/TVC | 参考视频 | 同风格新视频 |

---

## 4. Agent Skill 协议范本(`libtv-skills`)

### 4.1 5 个脚本(纯 Python 标准库)

| 脚本 | 作用 | 关键参数 |
|------|------|---------|
| `create_session.py` | 创建会话 / 发消息 | `message`、`--session-id`(已有会话追加)、无 message 时只绑定项目 |
| `query_session.py` | 拉取会话消息 | `SESSION_ID`、`--after-seq`(增量)、`--project-id`(带 projectUrl) |
| `change_project.py` | 切换当前 accessKey 绑定项目 | 无参,返回新 projectUuid |
| `upload_file.py` | 上传图片/视频到 OSS | 文件路径,返回 OSS URL |
| `download_results.py` | 批量下载会话结果 | `SESSION_ID`、`--output-dir`、`--prefix`、`--urls`(直接 URL 列表) |

### 4.2 4 个 REST 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/openapi/session` | 创建会话 / 发消息 |
| GET | `/openapi/session/:sessionId` | 查询会话消息(`?afterSeq=N` 增量) |
| POST | `/openapi/session/change-project` | 切换绑定项目 |
| POST | `/openapi/file/upload` | multipart 图片/视频上传 OSS |

### 4.3 鉴权与环境

- 鉴权头: `Authorization: Bearer <LIBTV_ACCESS_KEY>`
- 服务地址: `OPENAPI_IM_BASE` 默认 `https://im.liblib.tv`
- 上传约束: 仅 `image/*` 和 `video/*`,≤200MB
- OSS 地址格式: `https://libtv-res.liblib.art/claw/{projectUuid}/{uuid}{ext}`

### 4.4 轮询策略(SKILL.md 强制)

- **间隔**: 8 秒
- **增量**: 首次 `--after-seq 0`,后续用上次最大 seq
- **完成判断**: messages 中出现 assistant 消息且 content 包含结果 URL
- **超时**: 连续 3 分钟无结果 → 告知用户"生成时间较长",停止轮询
- **重试**: 单次查询失败可重试 1 次,连续 3 次失败停止

### 4.5 自动下载与命名

任务完成后**自动执行下载**,不需用户额外请求。前缀按语义自动命名:
- 分镜 → `storyboard_01.png`...
- 角色设定 → `character_01.png`...
- 默认 → `01.png`...

### 4.6 核心原则原文摘录(必抄)

> **用户侧不做创作,只做传话**
>
> 你(用户侧 Agent)的职责是**搬运工**,不是创作者。后端有专门的 Agent 负责理解需求、拆解分镜、编排工作流、选模型、写 prompt。你要做的只有三件事:
>
> 1. **上传**:用户给了本地文件 → `upload_file.py` 拿到 OSS URL
> 2. **传话**:把用户的原始描述 + OSS URL 原封不动发给 `create_session.py`
> 3. **取件**:轮询结果 → 下载到本地 → 展示给用户
>
> **绝对不要做的事:**
> - 不要替用户扩写、润色、翻译 prompt
> - 不要自行拆解任务步骤
> - 不要自行编排镜头描述、剧情推演、风格分析
> - 不要在消息中添加自己编的 prompt

**Flovart 实现启示**: Agent Skill 协议层保持薄,真正的 prompt 工程放在 Go 后端的"创作 Agent"层。这避免用户侧 Agent 把弱模型带崩。

---

## 5. 典型工作流(SKILL.md 给定 4 场景)

### 场景 1: 用户要求生成图片/视频(最常见)

```
1. create_session.py "用户的描述"  →  sessionId + projectUuid
2. 每 8 秒 query_session.py SESSION_ID --after-seq 0
3. messages 出现 assistant + 结果 URL → 完成
4. download_results.py SESSION_ID --output-dir ~/Downloads/项目名 --prefix 语义前缀
5. 展示:本地文件 + projectUrl(画布链接)
```

### 场景 2: 用户提供文件 + 编辑指令

```
1. upload_file.py /path/to/video.mp4  →  oss_url
2. create_session.py "把纸船换成爱心 参考视频:{oss_url}"
3. 同场景 1 步骤 2-5
```

### 场景 3: 用户提供参考图 + 生成新内容

```
1. upload_file.py /path/to/ref.png  →  oss_url
2. create_session.py "根据参考图生成 xxx,参考图:{oss_url}"
3. 同场景 1 步骤 2-5
```

### 场景 4: 已有会话追加新需求

```
1. create_session.py "新的描述" --session-id SESSION_ID
2. 同场景 1 步骤 2-5
```

---

## 6. LibTV 与 basketikun/infinite-canvas 的同构映射

| LibTV 概念 | basketikun 对应 | Flovart 应取 |
|-----------|----------------|-------------|
| 5 类基础节点 | `CanvasNodeType { Image, Text, Config, Video, Audio }` | 直接复用 basketikun 枚举 |
| 脚本节点 | config 节点的特殊模式 + LLM 拆解 | 新增 `script` 节点类型(挂在 config 之上) |
| 三视图 / 9 宫格 / 25 帧 | basketikun 无 | 新增 `matrix_generator` 服务函数 |
| 摄影机/光线参数 | basketikun 无 | 扩展 config 节点 metadata:`camera/lens/focalLength/aperture/cameraMove/lighting` |
| Agent Skill | basketikun 23 个 MCP 工具 | 拆两层:画布操作工具(沿用 basketikun) + 创作工具(沿用 LibTV 5 脚本范式) |
| 项目画布链接 | basketikun 无 | Flovart hub 加 `POST /openapi/session` 同款端点 |
| OSS 上传 | basketikun localForage | Flovart 已有 R2 上传,直接复用 |

---

## 7. Flovart Workflow 重构必抄清单

### 7.1 必抄(协议层,无版权风险)

1. **5 个脚本 + 4 个端点的 Agent Skill 协议结构** — 直接照搬命名,挂到 `tools/flovart/skills/` 下
2. **8 秒轮询 + 3 分钟超时 + 增量 seq** — 实现细节照抄
3. **"用户侧 Agent 不做创作"系统 prompt** — 原文照抄到 Flovart agent skill 的 SKILL.md
4. **5 类节点 + 连线语义** — 与 basketikun 合并,统一用 config 节点范式
5. **双击空白创建节点 + 模板选择** — 交互照搬
6. **自动下载 + 语义前缀命名** — Flovart 已有 `exportMediaArchive`,扩展即可

### 7.2 必自研(能力层,LibTV 不开源)

1. **角色三视图生成** — 调多视图 LoRA 或 ControlNet;若无,简化为"3 次 prompt 变体"
2. **9 / 25 帧分镜网格** — 调 N 次文生图拼成网格;后端 `service/storyboard.go`
3. **摄影机/光线参数注入** — 把字段拼到 prompt 前缀;后端 `service/camera_params.go`
4. **关键帧拼成片** — ffmpeg concat;后端 `service/video_stitch.go`
5. **场景预测 3 秒后/5 秒前** — 图生视频 3 秒 / 反向提示
6. **风格迁移 / 元素替换** — 已有 Provider 层接入

### 7.3 必扩(在 basketikun 之上加 LibTV 字段)

basketikun 的 `CanvasNodeData.metadata` 需扩展:

```ts
metadata: {
  // basketikun 原有
  content, prompt, status, generationMode, model, size, quality, count,
  seconds, vquality, generateAudio, watermark, audioVoice, audioFormat,
  audioSpeed, audioInstructions, inputOrder, storageKey, mimeType, bytes,
  naturalWidth/Height, isBatchRoot, batchRootId, batchChildIds, primaryImageId,
  imageBatchExpanded, freeResize,

  // LibTV 扩展
  nodeSubtype?: 'script' | 'storyboard_grid' | 'character_sheet' | 'shot',
  camera?: { camera: string, lens: string, focalLength: string, aperture: string, cameraMove: string },
  lighting?: { preset: string, intensity: number, temperature: number },
  gridSpec?: { rows: number, cols: number, count: number },  // 9 宫格 / 25 帧
  characterRefs?: string[],  // 角色三视图节点 ID 锚定
  scriptBreakdown?: { shots: Array<{ idx, emotion, action, sfx, dialogue }> },
  stitchFrom?: string[],  // 关键帧拼成片来源视频节点 ID
}
```

---

## 8. 取舍风险

1. **20+ 专业能力全抄成本极高**。建议优先做 5 个最高价值:角色三视图、9 宫格分镜、摄影机参数、关键帧拼成片、风格迁移。其余 15+ 留到后续迭代。
2. **"用户侧 Agent 不做创作"原则与 jaaz 的"Agent Chat 替用户写 prompt"冲突**。Flovart 需要二选一或分层:简单生成走 jaaz 路线(用户侧 agent 直接调工具),复杂短剧/MV 走 LibTV 路线(用户侧 agent 只传话,后端创作 agent 编排)。
3. **LibTV 30+ 视频模型大部分是闭源 API**。Flovart BYOK 模式下用户自带 Key,只能保证"接入模型",不能保证"同等质量"。文档要写清。
4. **脚本节点的 LLM 拆解质量决定整条链路上限**。Flovart 需要选一个强文本模型做默认创作 Agent(后端 `service/creative_agent.go`),不能让用户随意切弱模型。
5. **Agent Skill 协议太薄会让用户侧 Agent 抓狂**。LibTV 后端有"专门创作 Agent"接住裸 prompt。Flovart 若后端创作 Agent 还没建好就开放 Skill,用户侧 Agent 会直接把弱模型带崩。**必须先建后端创作 Agent,再开放 Skill**。

---

## 9. 关键文件索引

- `libtv-skills/skills/libtv-skill/SKILL.md`(原文 200+ 行,已逐字核对)
- `libtv-skills/skills/libtv-skill/scripts/{create_session,query_session,change_project,upload_file,download_results}.py`
- `openclaw/skills/skills/316530790/libtv-skills/SKILL.md`(ClawHub 同步副本)
- ClawHub: `https://clawhub.ai/haofanwang/skills/libtv-skill`
- 平台 URL: `https://www.liblib.tv/canvas?projectId={projectUuid}`

---

报告完。
