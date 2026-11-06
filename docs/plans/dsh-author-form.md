# DSH 插件作者与合作意向登记：填写文案

表单：
状态：草稿（2026-11-06）。带【待确认】的项需本人确认后再填。时机：0.3.0 内测上线后提交，DSH 工作台尚未上架，阶段如实填「正在开发」。

## 1. 姓名／昵称 Name / Nickname
【待确认】ava（GitHub：avabbbb）

## 2. 邮箱 Email
【待确认】填常用联系邮箱。

## 3. 你的身份 Your Role
个人作者 Individual【若以团队名义报名改选「创业公司／独立团队」】

## 4. 团队／公司信息（选填）
个人作者可留空；如需填写：Flovart ·

## 5. 插件名称／想法名称 Plugin Name / Idea
Flovart 画布（flovart-dsh）：在 DeepSeek Harness 里用对话编排 AI 图像／视频创作流程
Flovart Canvas (flovart-dsh): orchestrate AI image & video creation workflows from a DeepSeek Harness conversation

## 6. 当前阶段 Current Stage
正在开发 In development
（Flovart 本体网页版与桌面端已可体验；DSH 工作台接入开发中。旧版 DSH 插件曾在 rc.8 跑通，0.2.x 工作台协议需重做。）

## 7. 插件／想法简介 About Your Plugin / Idea
面向短视频、自媒体和 AIGC 创作者。Flovart 是一张可视化创作画布：图像、视频、音频生成节点和剪辑工具节点（截取、合并、分离音轨、取帧等）连成工作流，一键运行，结果留在画布上可复用。接入 DSH 后，画布作为工作台出现在 DSH Desktop 左侧，界面保持不变；DSH 主对话里的 Agent 通过插件工具读取画布、增删改节点、连线并运行生成，删除和付费生成等操作在画布内由用户确认，每次修改有回执可撤销。模型走用户自己的 API Key，密钥只加密存在本机。目前网页版已上线，内置 Agent 能用自然语言搭建工作流，0.3.0 内测版本即将发布。

For short-video, self-media and AIGC creators. Flovart is a visual creation canvas: image, video and audio generation nodes plus editing nodes (trim, merge, audio split, frame extraction) are wired into workflows that run in one click and stay reusable on the canvas. As a DSH workbench, the canvas appears in DSH Desktop unchanged, and the DSH conversation agent reads the canvas, edits nodes and connections, and runs generations through plugin tools. Deletions and paid generations require user confirmation on the canvas, and every change returns a receipt and can be undone. Models run on the user's own API keys, stored encrypted locally. The web app is live with a built-in agent that builds workflows from natural language; the 0.3.0 beta ships soon.

## 8. 作品链接（选填）Links


（演示视频录好后补上）

## 9. 希望获得的支持或探索的合作（多选）
- Token 支持 Token support
- 技术交流与开发答疑 Technical exchange and development Q&A
- 作品推荐与曝光 Promotion and exposure for your work
- 用户反馈与产品打磨 User feedback and product refinement

## 10. 其他想说的（选填）
下一步：0.3.0 内测后把 Flovart 做成 DSH 工作台（customFrame 内嵌画布，Host 半注册 status / workflow.inspect / workflow.selection.get / workflow.apply / workflow.node.run 五个工具），本机验收后提交工作台市场。希望交流：工作台 API 与 Agent 工具权限（危险操作确认）的推荐做法；工作台内 iframe 的存储分区与数据迁移；工作台市场的上架节奏。

Next: after our 0.3.0 beta, ship Flovart as a DSH workbench (canvas embedded via customFrame, five host-side tools for inspecting and editing the workflow), then submit to the workbench marketplace. We'd value guidance on workbench API stability, agent tool permissions for destructive actions, and iframe storage partitioning.
