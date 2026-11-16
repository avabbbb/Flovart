---
id: digital-human
version: 1.0.0
title: 数字人口播成片
evalLayer: L4
appliesTo: 数字人口播视频（图生视频或实拍驱动，可能经过换脸、对口型、补帧、放大）
inputs:
  script: 口播文案
  pipeline: 制作链路（是否实拍、是否换脸、对口型方式、是否补帧放大）
  frames_meta: 关键帧时间点，与附带图像一一对应；口型检查用的特写帧在列表中标注
  audio_meta: 音频时长、是否与视频等长
sources:
  - 数字人制作复盘——里水数字人为例
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
---

# 判定说明

- 口型同步无法从静态帧精确判断，本 Rubric 只判「嘴在动且脸不乱」；精确的音画同步需要专门的同步检测模型，不由 LLM Judge 代替。
