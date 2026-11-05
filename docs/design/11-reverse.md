# 模块：Reverse（逆向）

> 状态：**Current truth**（2026-11-05 由 Table 改为 Reverse；主体为设计目标，已实现部分逐项标注）。总纲见[总体设计](00-overview.md)，交互规则见[交互设计](01-interaction.md)。

## 1. 职责

Reverse 占据原 Table 的顶栏位置，是**按 Hypit 代码架构与功能复刻**的视频逆向工作台：把一条参考（爆款）视频拆成 Script → 转写证据 → 对齐 → Timeline → 字幕 / 视觉 / 音频轨，再用用户自己的数字人角色与素材批量生成变体。

在 Hypit 之上的二次开发：**一个逆向工程可一键转成 Canvas 上的子画布节点**。子画布里是镜头、台词、参考帧与生成节点；双击子画布回到 Reverse 视图。Reverse 与 Canvas 通过同一 `workflow.apply` mutation 边界联动，不形成第二份 Workflow 权威。

## 2. 复刻边界（许可）

- 参照：`_ref/hypit`（gitignored 本地克隆，只读）。对齐其包分层、数据模型、术语与端到端数据流。
- 代码全部在 `services/reverse/` 自写。**不复制 Hypit 源文件、不把 `@hypit/*` 打进 bundle**：Hypit 为附加条件的 Apache-2.0（衍生品须同许可、不得商业再分发或多租户托管），与本仓库 MIT 冲突。
- WhisperX、ffmpeg、HTML 光栅化等本地能力：走 Flovart 本地 Runtime，或调用用户自装的 hypit CLI（`hypit transcribe` → `hypit.transcript@1`），结果作为 durable artifact 导回。浏览器内只跑纯 TS 层。

## 3. 模块映射（Hypit 包 → Flovart 实现）

| 层 | Hypit 包 | Flovart 文件 | 核心类型 / 函数 |
| --- | --- | --- | --- |
| L1 时间 | timeline, temporal | `services/reverse/temporal.ts` | `Timeline{id,frameRate,frameCount}`、`TemporalInstant`、`TemporalWindow`（半开）、`LocalTemporalDomain` |
| L1 叙事 | narrative, script | `services/reverse/narrative.ts`（已实现，扩展） | `parseReverseScript`：Segment、Role Cue、Selection `@{n}…@{/n}`、Moment `@{n!}`；Token 带 surface |
| L2 证据 | speech-evidence | `services/reverse/evidence.ts`（由 transcript.ts 演进） | `AlignedTranscriptEvidence{domainId,words}`；导入 WhisperX JSON / `hypit.transcript@1` |
| L3 对齐 | narrative-speech-alignment | `services/reverse/align.ts`（已实现） | 单调 M:N DP → `NarrativeAlignment` |
| L2 投影 | narrative-temporal | `services/reverse/projection.ts` | Alignment + Domain + Window → 绝对 Instant / Window |
| L2/L3 字幕 | caption, narrative-caption | `services/reverse/caption.ts` | `CaptionDocument`（无时间）+ `CaptionTiming`（按 Token 身份绑定） |
| L2 合成 | composition | `services/reverse/composition.ts` | `VisualTrack` / `AudioTrack`，`Present{span,order,z,elements}` |
| L5 运行 | run, result | `services/reverse/run.ts` | 变体矩阵 → 候选 / 复用 → 输出引用（durable artifact） |
| 二开 | —（Hypit 无节点图） | `services/reverse/canvas.ts` | `reverseToSubgraph` / `syncSubgraph`：逆向工程 ↔ Workflow 子画布 |

纯函数层不依赖 React / store；UI 只消费这些函数的结果。

## 4. 界面（对齐 Hypit Studio）

- 左：库（Source 参考视频与脚本 / Tasks 生成任务 / Artifacts 产物网格）。
- 中：参考视频预览 + 帧对齐播放头。
- 下：时间线 lane：每个 Projection 一条（Segment 行 + 词证据行）、公共 Instants 行、字幕 / 视觉 / 音频轨。
- 右：Inspector，编辑字段回写 Script / 工程状态并重新对齐。
- 顶部主 CTA：**转为画布**（已转过则为**同步到画布** / **在画布中打开**）。

## 5. 与 Canvas 联动

- Workflow 新增内置节点类型 `subgraph`：metadata 记 `reverseProjectId`、`collapsed`；子节点用可选字段 `parentId` 指向它。文档仍是扁平 nodes + connections。
- 一键转换：一次 `workflow.apply`（带 `projectId` / `expectedRevision` / `mutationId`）打包 subgraph 节点 + 子节点（script、镜头 text / image / video）+ 连线。
- 同步：子节点以稳定 key（镜头 / 槽位）对应逆向工程；重新同步只增改变化项，不覆盖用户在画布上已选的新版本。
- 双击 subgraph → 切到 Reverse 并打开对应工程；Reverse 内「在画布中打开」→ 切回 Canvas 并定位。
- 持久化：Workflow 持久化升版本并给旧节点补默认值；workspace 视图枚举 `table` 迁移为 `reverse`。

## 6. 游戏素材替换

素材台账 / 风格圣经 / 相似度门不属于 Hypit 架构，是场景 1（游戏素材替换）的能力。暂保留为 Reverse 内的独立分页，不混入视频逆向的数据模型；是否拆出单独 surface 待定（**设计目标**）。

## 7. 验证

逆向纯函数单测（解析、对齐、投影、字幕定时、转画布映射）；`tsc --noEmit`；Playwright：导入参考 → 对齐 → 转为画布 → 双击回到 Reverse，0 console error。
