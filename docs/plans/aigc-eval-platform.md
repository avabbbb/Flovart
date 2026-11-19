# 多模态 AIGC 评测平台计划（PROPOSAL，进行中）

> 状态：MVP 已在 `eval/aigc/` 实现（M0）；口径的权威是 [eval/eval.md](../../eval/eval.md) §4.1、§12、§13，本文只记设计取舍与分期。完成后蒸馏进 eval.md 并归档本文。

## 1. 目标与边界

Iris 的 L4（创作效果）此前只有 Judge Rubric 和偏好对比较，没有题库、没有客观指标、没有按场景 / 难度的比率报告。本计划在现有评测体系里补上这一层，不另起一套：

- **同一套口径**：Rubric 仍在 `eval/judge/rubrics/`，Judge、清洗、成对比较、kappa / Wilson、门禁都复用 `eval/judge/lib/`。
- **两条轨道分开报告**：客观轨（规则 grader，100% 自动）与主观轨（1–5 盲评或记录下来的 Judge 整体分），参照 Seedance 2.0 SeedVideoBench 2.0，不合成一个分数。
- **不花钱**：MVP 不调生成、不调 RunningHub、不调真实 Judge；媒体用 ffmpeg 现场合成，主观分来自记录的评分文件。
- **不进产品 UI**：看板是本地生成的只读静态 HTML；唯一的产品改动是「设为首图」记偏好事件（只记 ID）。

## 2. 数据模型

| 记录 | Schema | 说明 |
| --- | --- | --- |
| 条目 `AigcItem` | `eval/schema/aigc-item.schema.json` | 任务域 × 场景 × 能力标签 × 难度 × 划分；中英提示词与负向词；按角色分组的条件素材（`ref_image / first_frame / last_frame / face_ref / ref_video / ref_audio / ground_truth`，每个带 uri、sha256、mime、授权）；约束（比例、时长、分辨率、要渲染的文字、音频）；逐条可检查的 QA；Rubric id；来源 |
| 生成 `AigcTake` | `eval/schema/aigc-take.schema.json` | 候选（模型、版本、线路、参数、Skill 版本、**改写后的提示词**、seed）、输出素材组、费用（元）、耗时、同批备选关系与是否被选中 |
| 评分 `AigcRating` | `eval/schema/aigc-rating.schema.json` | 一个 take 在一个维度上的分：质量类 1–5、多模态任务遵循 1–3；评分人匿名；复核标签带 `audit.of` |
| 偏好事件 | `services/preferenceEvents.ts`、`eval/aigc/lib/preferences.mjs` | 用户「设为首图」：`{nodeId, chosen, rejected, prompt, model, time}`，不含媒体本体 |

条目的语义规则（Schema 表达不了的）在 `eval/aigc/lib/dataset.mjs`：每个任务域必须带的条件素材（i2v 要首帧、flf2v 要首尾帧、r2v 至少一种参考、视频编辑 / 延展要参考视频、数字人要形象参考）；`face_ref` / `ref_audio` 只接受本人书面授权（带 `consent.ref`）、自有或合成素材；TTS 的参考音频不能就是目标音频；Rubric 必须存在；检查项的父项必须存在。

## 3. 客观轨

`eval/aigc/graders/index.mjs`，全部本地 ffprobe / ffmpeg：

| Grader | 判什么 |
| --- | --- |
| `file-valid` | 输出能解析、非空、能读出对应的流；给了 sha256 时一致 |
| `aspect` | 宽高比与约束相差 ≤2% |
| `duration` | 时长在容差内（默认 0.5 秒） |
| `has-audio` | 要求音频时有音轨或单独的音频输出 |
| `av-duration-match` | 音频与视频时长差 ≤0.2 秒（与 `DH-HONEST-01` 同一口径） |
| `dynamic-degree` | 4 fps、32×18 灰度下相邻帧平均差异不低于阈值，防止用近乎静止的视频刷画质分（VBench dynamic degree 的轻量替代；阈值需用人工标注校准） |

**稳定性**：每个 grader 对同一个 take 跑 N 次（默认 3）。只要有一次结论或数值不同，这个 grader 在该条目上就是不稳定的，**整个条目撤回**（`withdrawn`，写明原因），不计入任何比率。远程 URI 不下载，记为「无法运行」，也不计入分母，更不算通过。

## 4. 主观轨与比率

- 每个 take、每个维度取评分人的**下中位数**（两人差一档时取低的）。
- 质量类 1–5：可用率 = ≥3，满意率 = ≥4，惊喜率 = 5；多模态任务遵循 1–3：完全遵循 = 3，部分及以上 = ≥2。阈值写在 `video-shot` / `digital-human` Rubric 的 `scales` 里，单测保证代码与 Rubric 一致。
- 每个比率都带 95% Wilson 区间，按任务域、场景、难度、划分、模型分组。
- 人工复核：按哈希随机抽 20% 的人工标签复核，复核分与原分落在同一档（1–2 / 3 / 4 / 5）的比例 ≥95% 才算这批标签合格。

## 5. 存储与看板

- 结果库在 `eval/aigc/results/`（不进 git）：优先 `node:sqlite`（Node 22.5+ 内置），不可用时退回 JSONL；`IRIS_AIGC_STORE=jsonl` 可强制。库里只有判定、撤回、评分和 take 元数据，没有媒体。
- `node eval/aigc/run.mjs report` 生成 `results/report/index.html` 与 `report.json`：无脚本、无外链、全部转义。

## 6. 偏好事件

- 画布上「设为首图」（节点下的备选卡片与预览画廊都走 `promoteNodeAlternate`）成功后，记一条事件到本地 localforage（最多 2000 条）。rejected = 被换下去的首图 + 与被选中者同一批的其他备选。
- Agent 的 `workflow.batch.pick` 是自动挑选，不是用户偏好，不记。
- 导出：无头浏览器里 `await window.__irisPreferenceEvents.exportJsonl()`（只读），再 `node eval/aigc/run.mjs prefs-export --events <file>` 转成 `eval/judge` `pairs` 的输入：每个节点只取最后一次选择；A / B 位置按 pair id 哈希决定，标准答案在 A、B 两侧大致均衡。pair 带 `refs`（媒体变体 ID），真实 Judge 跑之前需要按 ID 取图 / 抽帧作为 `images` 附上。

## 7. 分期

| 期 | 内容 | 状态 |
| --- | --- | --- |
| M0 | Schema、示例题库（7 条，含 holdout 与一条撤回示例）、6 个客观 grader + 稳定性撤回、比率与 Wilson、sqlite / JSONL 结果库、静态看板、Rubric 音画与叙事子项、偏好事件采集与导出、单测 | 已完成 |
| M1 | 题库扩到每个任务域 × 场景至少 5 条（先 t2i / i2v / 数字人），每条补 sha256 与授权凭据；holdout 单独存放、不给调提示词的人看 | 待做 |
| M2 | 客观轨补 OCR（中文文字命中率）、TTS WER / SIM（参考 ≠ 目标）、首帧相似度；`dynamic-degree` 阈值用人工标注校准 | 待做 |
| M3 | 关键帧抽取接 `frames_meta` / `audio_meta`，偏好对附图后在真实 Judge 上跑；主观轨首批人工盲评（每个格子至少 30 个 take）与 20% 复核 | 待做（会花钱，先估价） |
| M4 | 比率接入 `gate`：模型 / Skill / 改写器变更的准入看可用率区间 | 待做 |

## 8. 不做

- 不在产品里做评测页面；看板只是本地文件。
- 不把参考视频、人脸、声音提交进仓库；题库只放合成素材或带授权凭据的引用。
- 不用均分做结论；不把客观轨和主观轨相加。
