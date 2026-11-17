---
id: digital-human
version: 1.1.0
title: 数字人口播成片
evalLayer: L4
appliesTo: 数字人口播视频（图生视频或实拍驱动，可能经过换脸、对口型、补帧、放大）
inputs:
  script: 口播文案
  pipeline: 制作链路（是否实拍、是否换脸、对口型方式、是否补帧放大）
  frames_meta: 关键帧时间点，与附带图像一一对应；口型检查用的特写帧在列表中标注
  audio_meta: 音频时长、是否与视频等长（客观轨 av-duration-match）、音频转写、削波 / 杂音 / 静音标记
sources:
  - 数字人制作复盘——里水数字人为例
  - Seedance 2.0 SeedVideoBench 2.0（arXiv 2604.14148）：音频质量、音画同步、音频提示遵循与叙事维度；质量 1–5 与可用 / 满意 / 惊喜率
  - Seed-TTS / MiniMax-Speech：WER（转写对照文案）与说话人相似度；参考音频不能就是目标音频
scales:
  quality:
    min: 1
    max: 5
    dims: [overall, aesthetics, audioQuality, avSync, audioPromptFollowing, narrative]
    anchors:
      1: 不可用：脸崩、口型完全不动或声音不可懂
      2: 有明显问题，修补也难以使用
      3: 可用：口播完整，有可见瑕疵
      4: 满意：口型、动作、声音都自然，瑕疵轻微
      5: 惊喜：接近实拍，可直接发布
    rates: { usability: 3, satisfaction: 4, delight: 5 }
  taskFollowing:
    min: 1
    max: 3
    dims: [taskFollowing]
    anchors:
      1: 没有使用形象参考或参考音频
      2: 只用上一部分（例如音色对了、形象不像）
      3: 形象与声音参考都被执行
    rates: { partial: 2, follow: 3 }
items:
  - code: DH-CTX-01
    layer: CTX
    name: 可评
    pass: 有关键帧、有文案、有制作链路说明
    fail: 不使用
    na: 缺关键帧或缺文案
    evidence: [script, frames_meta]
  - code: DH-HONEST-01
    layer: HONEST
    name: 音画等长
    pass: audio_meta 显示音频与视频时长一致（误差 0.2 秒内）
    fail: 音频与视频时长不一致
    evidence: [audio_meta]
  - code: DH-CONTENT-01
    layer: CONTENT
    name: 口型面部稳定
    pass: 特写帧中嘴部形状随文案变化，面部轮廓在帧间稳定
    fail: 面部在帧间抖动、变形（换脸后对口型的已知问题）或嘴部始终不动
    evidence: [frames_meta, pipeline]
  - code: DH-CONTENT-02
    layer: CONTENT
    name: 动作自然
    pass: 有介绍性手势（如摊手）且姿态保持约 1–2 秒，动作幅度适中
    fail: 全程僵直，或动作浮夸、频繁大幅摆动
    evidence: [frames_meta]
  - code: DH-CONTENT-03
    layer: CONTENT
    name: 画质
    pass: 面部与边缘清晰，无明显模糊、闪烁或画面变暗
    fail: 面部模糊、帧间闪烁或整体变暗
    evidence: [frames_meta]
  - code: DH-CONTENT-04
    layer: CONTENT
    name: 音频质量
    pass: audio_meta 没有削波、爆音、电流声、混响过重或意外静音的标记，人声清晰
    fail: audio_meta 标出削波、爆音、杂音、意外静音，或人声含糊
    evidence: [audio_meta]
  - code: DH-CONTENT-05
    layer: CONTENT
    name: 音频提示遵循
    pass: audio_meta 的转写与口播文案一致（只有个别字差异），没有漏句、多句或读错关键词（品牌名、数字）
    fail: 转写与文案明显不一致：漏句、多句、关键词读错，或没有转写可对照
    evidence: [script, audio_meta]
  - code: DH-CONTENT-06
    layer: CONTENT
    name: 叙事节奏
    pass: 手势、表情与文案段落对应（介绍处摊手、强调处点头），段落之间有停顿，不是从头到尾一个节奏
    fail: 动作与文案无关、该停的地方不停，或整段节奏单一
    evidence: [script, frames_meta]
  - code: DH-RED-01
    layer: RED
    name: 授权
    pass: pipeline 标明使用本人授权的实拍或形象素材
    fail: 对真人换脸 / 声音克隆没有授权说明
    evidence: [pipeline]
changelog:
  - version: 1.0.0
    date: 2026-11-16
    change: 初版，条目来自里水数字人复盘
  - version: 1.1.0
    date: 2026-11-17
    change: 新增 DH-CONTENT-04 音频质量、05 音频提示遵循（转写对照文案）、06 叙事节奏；audio_meta 扩充转写与音质标记；新增 scales（质量 1–5、多模态任务遵循 1–3）与比率阈值。预计影响：没有转写证据的样本在 DH-CONTENT-05 判不通过，采集链路需补转写
---

# 判定说明

- 口型同步无法从静态帧精确判断，本 Rubric 只判「嘴在动且脸不乱」；精确的音画同步需要专门的同步检测模型，不由 LLM Judge 代替。
- 音频项只依据 audio_meta 中工具产出的证据（客观轨结果、转写、音质标记）；转写对照文案的字错率（WER）由工具算出后写进 audio_meta，Judge 不自己估算。
- scales 用于主观轨评分表（人工盲评或记录下来的 Judge 整体分）：质量类 1–5，可用率 = ≥3、满意率 = ≥4、惊喜率 = 5；形象与声音参考是否执行用 1–3。
