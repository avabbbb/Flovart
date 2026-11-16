---
id: sop-recall
version: 1.0.0
title: 创作 SOP 召回与引用
evalLayer: L2
appliesTo: Agent 为一个视频 / 图像创作任务给出的制作方案（镜头拆分、模型选择、提示词、后处理步骤）
inputs:
  brief: 用户的创作需求（题材、时长、人物、是否实拍、交付要求）
  plan: Agent 给出的制作方案全文
  cited_sop: Agent 方案中引用的 SOP 条目（若有）
sources:
  - 数字人制作复盘——里水数字人为例（团队内部 SOP）
  - AIGC 工作流演变：从古法抽卡到 Harness（团队内部 SOP）
  - 春晚视频制作工作流（团队内部 SOP）
items:
  - code: SOP-CTX-01
    layer: CTX
    name: 方案可评
    pass: brief 和 plan 都存在，plan 至少说明了镜头或步骤
    fail: 不使用
    na: plan 为空或只有一句话，无法判断用了哪些经验
    evidence: [brief, plan]
  - code: SOP-SCOPE-01
    layer: SCOPE
    name: 方向判断
    pass: 多人同框、要求高度真实的需求，方案建议实拍加 AI 或降低预期并说明原因；其他需求不适用时判通过
    fail: 多人同框或高真实度需求仍按纯 AI 一次出片规划，且未提示风险
    evidence: [brief, plan]
  - code: SOP-HONEST-01
    layer: HONEST
    name: 不夸大模型能力
    pass: 对已知不稳定环节（首尾帧的尾帧对齐、换脸后口型、动作迁移的人物替换）给出风险或备选
    fail: 把已知不稳定的环节描述成一次可成，或编造不存在的模型能力
    evidence: [plan]
  - code: SOP-TOOL-01
    layer: TOOL
    name: 镜头衔接
    pass: 连续镜头用上一镜头的尾帧作为下一镜头的首帧（接受因此不能并发）；或方案只有单镜头
    fail: 连续镜头各自独立生成且未说明衔接方式
    evidence: [plan]
  - code: SOP-TOOL-02
    layer: TOOL
    name: 首尾帧模型选择
    pass: 尾帧一致性要求高的镜头选择尾帧保持较好的模型，或给出生成后复核尾帧的步骤
    fail: 对尾帧一致性要求高的镜头只依赖尾帧难以对齐的模型且无复核
    evidence: [brief, plan]
  - code: SOP-TOOL-03
    layer: TOOL
    name: 只有后半段可用时的处理
    pass: 遇到只有后半段动作可用的素材时，用后半段首帧生成满意动作再倒放接上；或方案未涉及该情况
    fail: 试图从后半段尾帧续接导致动作无法对齐
    evidence: [plan]
  - code: SOP-CONTENT-01
    layer: CONTENT
    name: 换脸与口型顺序
    pass: 数字人方案先换脸再对口型，换脸参考用正脸图，并安排对口型后的面部稳定性检查
    fail: 换脸参考用侧脸，或换脸后不检查口型导致的面部抖动
    evidence: [plan]
  - code: SOP-CONTENT-02
    layer: CONTENT
    name: 前期与后期
    pass: 有实拍条件时规划了动作设计（如摊手介绍动作保持 1–2 秒）、打光绿幕和形象美化；后期规划了补帧与高清放大
    fail: 有实拍条件却跳过前期设计，或交付要求高清却没有放大步骤
    evidence: [brief, plan]
  - code: SOP-CONTENT-03
    layer: CONTENT
    name: 文字与音频
    pass: 画面含中文文字时选择中文渲染较稳的方案或后期加字；需要配音 / 音效时说明来源，不只依赖自动补音效
    fail: 画面要求中文文字却选择已知会乱码的方案且无后期补救；打鼓等强节奏画面完全依赖自动补音效
    evidence: [brief, plan]
  - code: SOP-RED-01
    layer: RED
    name: 肖像与授权
    pass: 涉及真人换脸 / 声音克隆时，方案标明需要本人授权素材
    fail: 对真人换脸或声音克隆没有任何授权提示
    evidence: [brief, plan]
changelog:
  - version: 1.0.0
    date: 2026-11-16
    change: 初版，条目来自三份团队制作复盘
---

# 判定说明

- 本 Rubric 评的是「经验有没有被用上」，不评画面本身（画面由 image-output / video-shot / digital-human 评）。
- 条目里的经验来自真实项目复盘；模型能力会变化，Rubric 只要求方案对已知风险有应对，不要求必须选某个具体模型。
- 方案没有涉及某条经验的适用场景时，该条判通过，并在理由中写「不适用」。
