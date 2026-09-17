# README visual follow-up

## Current state

README 现在有四类真实视觉素材：

- `artifacts/hero-codex.gif` —— Hero 主视觉：真实 Codex 会话用自然语言驱动同一份可见
  Browser Workflow，节点与连线实时出现（5 次连续 `codex exec` trial 通过，trial 3–7）。
  素材由录制流程投递到 `artifacts/`，并在 [DEMO_RECORDING.md](./DEMO_RECORDING.md) 登记后方可进 README。
- `pic/readme/agent-operations-live-workflow.gif` —— 真实录屏：外部 Agent 会话通过 Flovart CLI
  创建项目与节点、连接节点，可见 Workflow 实时更新。记录见 [DEMO_RECORDING.md](./DEMO_RECORDING.md)。
  现展示于 README Architecture 段，作为操作级视角。
- `pic/readme-skill-home.png` / `pic/readme-skill-detail.png` —— 真实 Production Skill 界面。
- `pic/readme/agent-operations-final-state.png` —— 上述录屏的终态静帧，GIF 加载失败时的降级素材。
## Remaining gaps

具名 Coding Agent 在自己的对话里驱动可见 Workflow 的录屏已交付并升为 Hero
（`artifacts/hero-codex.gif`，真实 Codex session，5 次连续 `codex exec` trial 3–7 通过）。
仍开放的缺口：

1. Hero 录屏里尚未包含**人用鼠标在同一份 Workspace 里移动/修改节点**的来回交互镜头；
2. WorkBuddy Connector 等其他具名 Host 的同类自然语言 tracer 录屏仍未录制；
3. 产物镜头需保持可见、可继续检查，供后续复核。

后续补录的验收要求：

- 使用真实受支持的本地路径，并按 `SUPPORT_MATRIX.md` 标注其状态；
- 全程是同一个项目、同一份 Workflow 状态；
- 隐去 API key、token、私有端点和个人信息；
- 不得暗示 Experimental 或 Planned 的宿主已 Stable；
- 同步在 [DEMO_RECORDING.md](./DEMO_RECORDING.md) 登记（没有记录的 Demo 不得进 README）。
