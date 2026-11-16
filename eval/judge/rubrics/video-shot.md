---
id: video-shot
version: 1.0.0
title: 单个视频镜头质量
evalLayer: L4
appliesTo: 一个 video.generate 节点的一次 take（首帧 / 尾帧 / 参考可选）；Judge 读取按时间均匀抽取的关键帧
inputs:
  prompt: 视频提示词（正向与负向）
  first_frame: 首帧参考说明，图片作为图像输入附带
  last_frame: 尾帧参考说明，没有尾帧时为空
  config: 模型、时长、分辨率、比例
  frames_meta: 抽帧时间点列表（秒），与附带的图像一一对应
sources:
  - 数字人制作复盘：首尾帧模型尾帧难对齐、只有后半段可用时倒放接片
  - 春晚视频制作工作流：中文文字乱码、大动作脸部崩坏、尾帧接下一镜头首帧
  - Seedance SeedVideoBench 维度（运动质量、指令遵循、美学、原图保持）
pairwiseCriteria:
  - 首帧与参考图一致，尾帧与尾帧参考更接近
  - 动作自然连贯，无突变和抖动
  - 人物面部在整段中保持稳定、是同一个人
  - 提示词中的动作与运镜被执行
  - 画面中的中文文字没有乱码
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
---

# 判定说明

- 关键帧是抽样，帧与帧之间看不到的问题不判；理由里引用帧编号（如「第 3 帧」）。
- 只有后半段可用的镜头仍按整段判定；可用片段的裁切与倒放属于制作方案，在 sop-recall 中评。
