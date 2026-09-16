# README visual follow-up

## Current state

README 现在有三类真实视觉素材：

- `pic/readme/agent-operations-live-workflow.gif` —— 真实录屏：外部 Agent 会话通过 Flovart CLI
  创建项目与节点、连接节点，可见 Workflow 实时更新。记录见 [DEMO_RECORDING.md](./DEMO_RECORDING.md)。
- `pic/readme-skill-home.png` / `pic/readme-skill-detail.png` —— 真实 Production Skill 界面。
- `pic/readme/agent-operations-final-state.png` —— 上述录屏的终态静帧，GIF 加载失败时的降级素材。

## Still open

录屏证明的是 **CLI 那一半**：结构化操作确实作用于同一份可见 Workflow。
它还**没有**证明一个具名 Coding Agent 在自己的对话里完成这件事。要补的正是下面这条：

录一条真实 10–15 秒的 GIF 或 MP4，内容为：

1. 具名本地 Agent（Codex 或 WorkBuddy Connector）收到一句短 brief；
2. Agent 通过真实的 Link/CLI 路径打开绑定的 Workflow；
3. Agent 在那份可见 Workflow 里新增或连接节点；
4. 人用鼠标在同一份 Workspace 里移动或修改其中一个节点；
5. 产物保持可见、可继续检查。

验收要求：

- 使用真实受支持的本地路径，并按 `SUPPORT_MATRIX.md` 标注其状态；
- 全程是同一个项目、同一份 Workflow 状态；
- 隐去 API key、token、私有端点和个人信息；
- 不得暗示 Experimental 或 Planned 的宿主已 Stable；
- 只有这条录屏能独立复现之后，才考虑把它替换成 Hero 主视觉；
- 同步在 [DEMO_RECORDING.md](./DEMO_RECORDING.md) 登记（没有记录的 Demo 不得进 README）。
