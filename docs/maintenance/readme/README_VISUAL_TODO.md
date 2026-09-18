# README visual follow-up

## Current state

README 现在有五类真实视觉素材：

- `artifacts/hero-codex.gif` —— Hero 主视觉：真实 Codex 会话用自然语言驱动同一份可见
  Browser Workflow，节点与连线实时出现（5 次连续 `codex exec` trial 通过，trial 3–7）。
  **⚠️ 该路径已失效**：`.gitignore` 把整个 `artifacts/` 目录排除，`git ls-files artifacts/`
  为 0，仓库里没有这个文件，线上 README 的 Hero 图是坏的。待决定落位后修正引用。
- `pic/readme/agent-operations-live-workflow.gif` —— 真实录屏：外部 Agent 会话通过 Flovart CLI
  创建项目与节点、连接节点，可见 Workflow 实时更新。记录见 [DEMO_RECORDING.md](./DEMO_RECORDING.md)。
  现展示于 README Architecture 段，作为操作级视角。
- `pic/readme-skill-home.png` / `pic/readme-skill-detail.png` —— 真实 Production Skill 界面。
- `pic/readme/agent-operations-final-state.png` —— 上述录屏的终态静帧，GIF 加载失败时的降级素材。
- `pic/readme/features/*.gif` —— **功能演示组（Demo D，2026-09-18）**，README 新增
  「Feature tour / 功能演示」章节内嵌。每条一个操作，均由 `scripts/record-feature-clips.mjs`
  在真实 UI 上驱动并录制：
  - 画布：`canvas-add-node`、`canvas-connect`、`canvas-drag`、`canvas-tidy`、`canvas-prompt`
  - 图片节点：`crop`、`rotate`、`split-grid`、`filter`
  - 外部 Agent：`agent-cli-live`、`agent-open-panel`
  对应 MP4 母版与登记见 [DEMO_RECORDING.md](./DEMO_RECORDING.md)。

## Remaining gaps

具名 Coding Agent 在自己的对话里驱动可见 Workflow 的录屏已交付并升为 Hero
（`artifacts/hero-codex.gif`，真实 Codex session，5 次连续 `codex exec` trial 3–7 通过）。
仍开放的缺口：

1. **Hero 图引用失效**：`README.md` 指向被 gitignore 的 `artifacts/hero-codex.gif`。
   `README.zh-CN.md` 未受影响（它用的是 `pic/readme/`）。需要把 Hero 素材落到仓库跟踪目录
   并改引用，或恢复 artifacts 的提交策略。
2. Hero 录屏里尚未包含**人用鼠标在同一份 Workspace 里移动/修改节点**的来回交互镜头。
   Demo D 的画布组已补上人操作的部分，但两者不在同一段素材里。
3. WorkBuddy Connector 等其他具名 Host 的同类自然语言 tracer 录屏仍未录制。
4. **视频与音频节点工具：缺陷已修复，片段仍待补录**。原缺陷有三处叠加：core 指到了
   *umd* 构建（umd 无默认导出，而 `@ffmpeg/ffmpeg` 固定以模块 worker 启动，必然抛
   `failed to import ffmpeg-core.js`）；多线程分支向 `@ffmpeg/core` 索取只存在于
   `@ffmpeg/core-mt` 的 `ffmpeg-core.worker.js`（404）；以及 `@ffmpeg/ffmpeg` 被 Vite
   预打包后 `new Worker(new URL('./worker.js', import.meta.url))` 解析到不存在的
   `/node_modules/.vite/deps/worker.js`（404），使 `ffmpeg.load()` 永不 settle、工具静默卡死。
   三处已修（`services/ffmpegClient.ts` + `vite.config.ts`），并在跨域隔离页面内实测
   `getFFmpeg()` 加载成功、文件系统可读写、`exec` 可执行（详见
   [DEMO_RECORDING.md](./DEMO_RECORDING.md)）。
   **未完成**：这 8 条片段（视频剪辑、音视频分离、导出首/尾帧、提取指定帧、视频拼接、
   音频截取、音频变速、人声伴奏分离）的端到端录屏还没补——录制期间应用无法挂载，
   原因是 `services/dockCrewClient.ts` 仍 import 已被删除的 `components/dock/protocol`。
   该 import 恢复后按 DEMO_RECORDING 里的命令即可补录。
5. **多选打组 / 对齐未捕获**：`canvas-group-align` 在脚本中记为 `DEFERRED`——
   Shift+点击与框选都没能让工具栏渲染对齐与打组动作。
6. **缩放 / 撤销片段未捕获**：`canvas-zoom` 两次都因本地服务探测超时失败
   （`Timed out waiting for Flovart services`），与录制脚本逻辑无关。可单独重跑：
   `node scripts/record-feature-clips.mjs --clip canvas-zoom`。
7. 依赖 Provider 的生成类工具（图片生成、高清放大、移除背景、拆分图层、图片编辑/扩图）
   未录制：本机未配置任何模型服务。若要录，需明确记录 Provider 状态，
   且用 Fake Provider 时画面必须可辨认是 fixture。

后续补录的验收要求：

- 使用真实受支持的本地路径，并按 `SUPPORT_MATRIX.md` 标注其状态；
- 全程是同一个项目、同一份 Workflow 状态；
- 隐去 API key、token、私有端点和个人信息；
- 不得暗示 Experimental 或 Planned 的宿主已 Stable；
- 同步在 [DEMO_RECORDING.md](./DEMO_RECORDING.md) 登记（没有记录的 Demo 不得进 README）。
