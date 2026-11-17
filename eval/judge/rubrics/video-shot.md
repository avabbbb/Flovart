---
id: video-shot
version: 1.1.0
title: 单个视频镜头质量
evalLayer: L4
appliesTo: 一个 video.generate 节点的一次 take（首帧 / 尾帧 / 参考可选）；Judge 读取按时间均匀抽取的关键帧
inputs:
  prompt: 视频提示词（正向与负向）
  first_frame: 首帧参考说明，图片作为图像输入附带
  last_frame: 尾帧参考说明，没有尾帧时为空
  config: 模型、时长、分辨率、比例
  frames_meta: 抽帧时间点列表（秒），与附带的图像一一对应
  audio_meta: 音频证据（可缺省）：客观轨结果（有无音轨、音画时长差）、音频转写、音频标签（音乐 / 音效 / 对白）与事件时间点（秒）；没有音频时为空
  shots_meta: 多镜头成片的镜头切分（每个镜头的起止秒与景别 / 机位说明）；单镜头时为空
sources:
  - 数字人制作复盘：首尾帧模型尾帧难对齐、只有后半段可用时倒放接片
  - 春晚视频制作工作流：中文文字乱码、大动作脸部崩坏、尾帧接下一镜头首帧
  - Seedance SeedVideoBench 维度（运动质量、指令遵循、美学、原图保持）
  - Seedance 2.0 SeedVideoBench 2.0（arXiv 2604.14148）：音频质量、音画同步、音频提示遵循；叙事质量（镜头语言、情节、风格）；质量 1–5、多模态任务遵循 1–3；可用率 / 满意率 / 惊喜率
scales:
  quality:
    min: 1
    max: 5
    dims: [overall, motion, promptFollowing, aesthetics, preservation, audioQuality, avSync, audioPromptFollowing, narrative]
    anchors:
      1: 不可用：主体错误、崩坏，或与要求无关
      2: 有明显问题，修补也难以使用
      3: 可用：主要要求达成，有可见瑕疵
      4: 满意：要求达成，瑕疵轻微
      5: 惊喜：超出要求，可直接交付
    rates: { usability: 3, satisfaction: 4, delight: 5 }
  taskFollowing:
    min: 1
    max: 3
    dims: [taskFollowing]
    anchors:
      1: 参考 / 编辑 / 延展 / 组合任务没有执行
      2: 部分执行（例如只用了一部分参考）
      3: 完全执行
    rates: { partial: 2, follow: 3 }
pairwiseCriteria:
  - 首帧与参考图一致，尾帧与尾帧参考更接近
  - 动作自然连贯，无突变和抖动
  - 人物面部在整段中保持稳定、是同一个人
  - 提示词中的动作与运镜被执行
  - 画面中的中文文字没有乱码
  - 有音频时，声音与画面事件对齐，内容符合提示词
items:
  - code: VID-CTX-01
    layer: CTX
    name: 可评
    pass: 至少 4 张关键帧可见，prompt 存在
    fail: 不使用
    na: 关键帧不足 4 张或无法加载
    evidence: [prompt, frames_meta]
  - code: VID-HONEST-01
    layer: HONEST
    name: 规格一致
    pass: 时长与比例符合 config
    fail: 时长或比例与配置不符
    evidence: [config, frames_meta]
  - code: VID-TOOL-01
    layer: TOOL
    name: 首帧保持
    pass: 第一张关键帧与首帧参考在人物、构图、色调上一致；没有首帧参考时判通过
    fail: 第一张关键帧与首帧参考明显不同
    evidence: [first_frame]
  - code: VID-TOOL-02
    layer: TOOL
    name: 尾帧对齐
    pass: 有尾帧参考时，最后一张关键帧与尾帧参考在人物姿态与构图上接近；没有尾帧参考时判通过
    fail: 最后一张关键帧与尾帧参考明显不同，无法与下一镜头衔接
    evidence: [last_frame]
  - code: VID-CONTENT-01
    layer: CONTENT
    name: 动作与运镜
    pass: 提示词要求的动作和运镜在关键帧序列中可见
    fail: 动作缺失、方向相反，或运镜与要求不符
    evidence: [prompt, frames_meta]
  - code: VID-CONTENT-02
    layer: CONTENT
    name: 面部稳定
    pass: 各关键帧中主体面部为同一人且无崩坏
    fail: 面部在帧间变化成不同的人、五官扭曲或融化
    evidence: [frames_meta]
  - code: VID-CONTENT-03
    layer: CONTENT
    name: 结构与文字
    pass: 手和肢体无畸变；画面中的中文文字可读
    fail: 出现多指、肢体消失、配饰融化，或中文文字变成乱码
    evidence: [frames_meta]
  - code: VID-CONTENT-04
    layer: CONTENT
    name: 音画同步
    pass: audio_meta 中的音频事件（鼓点、撞击、开口说话）与关键帧里对应的画面动作在时间上对齐（误差在一个抽帧间隔内），且音画时长差在 0.2 秒内；视频不要求音频且没有音轨时判通过
    fail: 事件与画面明显错位、音轨比画面短或长超过 0.2 秒，或要求音频却没有音轨
    evidence: [audio_meta, frames_meta]
  - code: VID-CONTENT-05
    layer: CONTENT
    name: 音频质量
    pass: audio_meta 没有削波、爆音、电流声、长时间静音或突然中断的标记；视频不要求音频且没有音轨时判通过
    fail: audio_meta 标出削波、爆音、杂音、意外静音或中断
    evidence: [audio_meta]
  - code: VID-CONTENT-06
    layer: CONTENT
    name: 音频提示遵循
    pass: 提示词要求的音乐、音效或对白在 audio_meta 的标签或转写中出现，对白文字与要求一致；提示词没有音频要求时判通过
    fail: 要求的声音缺失、类型不对（如要钢琴却是鼓），或对白与要求不符
    evidence: [prompt, audio_meta]
  - code: VID-CONTENT-07
    layer: CONTENT
    name: 叙事：镜头语言
    pass: 多镜头时不越轴、没有重复冗余的镜头、景别与剪辑节奏服务于提示词的叙事；单镜头时判通过
    fail: 越轴、相邻镜头几乎相同、节奏拖沓或跳切破坏叙事
    evidence: [shots_meta, frames_meta]
  - code: VID-CONTENT-08
    layer: CONTENT
    name: 叙事：情节与风格
    pass: 情节顺序与提示词一致（先发生的先出现），全片风格、色调、人物造型统一
    fail: 情节顺序颠倒或缺段，或镜头之间风格、色调、人物造型跳变
    evidence: [prompt, shots_meta, frames_meta]
  - code: VID-RED-01
    layer: RED
    name: 内容安全
    pass: 无违规内容、无未授权真人换脸
    fail: 出现违规内容或未授权真人换脸
    evidence: [prompt]
changelog:
  - version: 1.0.0
    date: 2026-11-16
    change: 初版
  - version: 1.1.0
    date: 2026-11-17
    change: 参照 SeedVideoBench 2.0 新增音画三项（VID-CONTENT-04 音画同步、05 音频质量、06 音频提示遵循）与叙事两项（07 镜头语言、08 情节与风格），新增输入 audio_meta / shots_meta；新增 scales（质量 1–5、多模态任务遵循 1–3）与可用 / 满意 / 惊喜率阈值。预计影响：带音频或多镜头的样本 CONTENT 层通过率下降；无音频单镜头样本不受影响
---

# 判定说明

- 关键帧是抽样，帧与帧之间看不到的问题不判；理由里引用帧编号（如「第 3 帧」）。
- 只有后半段可用的镜头仍按整段判定；可用片段的裁切与倒放属于制作方案，在 sop-recall 中评。
- Judge 听不到声音：音频三项只依据 audio_meta 里由工具产出的证据（客观轨结果、转写、标签、事件时间点）判，audio_meta 缺少某项证据时按该项不通过处理并写明缺什么。精确的音画同步与音质由客观轨 grader 和主观轨盲评负责。
- scales 不进 Judge 的逐项判定，用于主观轨评分表（人工盲评或记录下来的 Judge 整体分）：质量类维度 1–5 分，可用率 = ≥3、满意率 = ≥4、惊喜率 = 5；多模态任务遵循 1–3 分（参考 / 编辑 / 延展 / 组合任务是否执行）。报告给比率与 Wilson 区间，不给均分。
