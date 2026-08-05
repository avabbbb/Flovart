# AI-Native 画布工作流蓝图：为什么天空是蓝色的

> 目标：Coding Agent 直接在可见 Workflow 画布上搭出完整 VOX 工作流——
> 每个节点的提示词写在 `metadata.prompt`（PromptBar 可见可编辑），
> 节点用真实连线串起来，设计师看到的是一个**可复用的制作流程**，而不是后端生成的成品堆。

## 结构

```
[plan] 计划标题（text）
  ├─ [kf:hook-wide] 关键帧·撕纸标题+阳光（image, prompt=…）
  │    └─ [mv:hook-wide] 动态镜头·推近（video, prompt=…, sourceImage=@kf）
  ├─ [kf:hook-detail] 关键帧·空气分子特写（image）
  │    └─ [mv:hook-detail] 动态镜头·纸屑散开（video）
  ├─ [kf:context-wide] 关键帧·棱镜分光（image）
  │    └─ [mv:context-wide] 动态镜头·光谱展开（video）
  ├─ [kf:context-detail] 关键帧·蓝红光谱对照（image）
  │    └─ [mv:context-detail] 动态镜头·滑动对照（video）
  ├─ [kf:turn-wide] 关键帧·蓝光散射星芒（image）
  │    └─ [mv:turn-wide] 动态镜头·散射动画（video）
  ├─ [kf:turn-detail] 关键帧·单分子图解（image）
  │    └─ [mv:turn-detail] 动态镜头·箭头绘制（video）
  ├─ [kf:payoff-wide] 关键帧·蓝天vs日落（image）
  │    └─ [mv:payoff-wide] 动态镜头·对照展开（video）
  ├─ [kf:payoff-detail] 关键帧·散射+印章收束（image）
  │    └─ [mv:payoff-detail] 动态镜头·落印（video）
  └─ [narration] 旁白（text/audio）
```

## 关键帧提示词（写入节点 `metadata.prompt`）

统一 VOX 风格语言（swiss-modern 拼贴）：
> mixed-media hand-cut paper collage, torn paper edges, newsprint halftone,
> masking tape, offset grain, condensed grotesque headline typography,
> flat 2D paper layers, straight-on scanned composition, 16:9, 1k.

- **hook-wide**: 「撕纸标题“天空为什么是蓝色的？”压住一张蓝天海报，白色阳光从左上角射入。」+ style
- **hook-detail**: 「放大阳光穿过一团纸剪空气分子的瞬间，纸屑向两侧散开。」+ style
- **context-wide**: 「一张白色纸卡投过纸棱镜，展开成完整的七色光谱条带。」+ style
- **context-detail**: 「光谱特写：蓝色一端与红色一端并排对照，“波长”标签钉在纸上。」+ style
- **turn-wide**: 「阳光横穿一片纸剪空气分子，蓝色光束向四周散射成星芒，红色光束笔直穿过。」+ style
- **turn-detail**: 「一颗放大的空气分子特写：蓝光四散、红光直穿的小图解，箭头标注散射方向。」+ style
- **payoff-wide**: 「左右对照：白天蓝天与日落橙红天空，共用同一条地平线纸卡。」+ style
- **payoff-detail**: 「日落天空细节，短标题“散射”与一枚红色印章收束画面。」+ style

## 动态镜头提示词（写入节点 `metadata.prompt`）

每个动态镜头 `@关键帧` 图生视频，镜头运动见 spec `shotDirectives`：
push_in / element / static / pan / element / static / pull_out / element（相邻不重复）。

## 旁白（写入 narration 节点）

4 节拍旁白（zh-CN，documentary-neutral）：
1. 天空为什么是蓝色的？答案就藏在你每天呼吸的空气里。
2. 太阳光看起来是白色的，其实它混着红橙黄绿蓝紫七种颜色。
3. 空气分子很小，却会把短波的蓝光弹向四面八方，这就是散射。
4. 所以无论看向哪个方向，都是散射的蓝光；日落时阳光斜穿大气，剩下的便是橙红。

## AI-Native 构建命令序列（等 app 起来后执行）

```bash
# 1. 创建项目 + 激活
workflow.project.create --title "AI-Native VOX 工作流"
workflow.project.use --project-id <id>

# 2. 计划节点
workflow.node.create --type text --title "AI-Native VOX 计划：为什么天空是蓝色的" --metadata-json '{"content":"..."}'

# 3. 关键帧节点（image，prompt 写入 metadata）
workflow.node.create --type image --title "关键帧 · hook-wide" --metadata-json '{"prompt":"撕纸标题…+style","productModel":"flovart:gpt-image-2"}'

# 4. 动态镜头节点（video，@关键帧）
workflow.node.create --type video --title "动态镜头 · hook-wide" --metadata-json '{"prompt":"…","productModel":"flovart:grok-imagine-video-1.5"}'
workflow.node.create-connected --from-node-id <kf> --type video --title "动态镜头 · hook-wide" --metadata-json '{...}'

# 5. 连线（关键帧 → 动态镜头）
workflow.connect --from-node-id <kf> --to-node-id <mv>

# 6. 验证
workflow.inspect
```

## 与 production.run 的区别

| 维度 | production.run（后端生成） | AI-Native（画布直搭） |
| --- | --- | --- |
| 提示词落点 | Runtime spec，画布只有成品 | 每个节点 `metadata.prompt`，PromptBar 可见可编辑 |
| 连线 | 投影适配器铺 | Agent 用 workflow.connect 真实连线 |
| 设计师二次编辑 | 只能看到成品，无从改起 | 每个节点、每条连线、每个提示词都可改 |
| 过程可追溯 | 无 | 画布即过程 |
