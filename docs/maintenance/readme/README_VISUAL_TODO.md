# README visual follow-up

## Current state

README 现在有五类真实视觉素材：

- `pic/readme/hero-agent.gif` —— Hero 主视觉：外部 coding agent（WorkBuddy codebuddy）读仓库自带的
  Flovart Skill，经 typed CLI 驱动同一份可见 Browser Workflow，现场创建 3 个节点与 2 条连线，
  无源码改动、未跑生成（即未调用付费模型服务）。录制与证据见
  [DEMO_RECORDING.md](./DEMO_RECORDING.md)。
  **2026-09-18 修正了两处遗留问题**：
  1. 原引用 `artifacts/hero-codex.gif`，而 `.gitignore` 忽略整个 `artifacts/`（`git ls-files artifacts/`
     为 0），该文件不会入库 → 线上是坏图。现已重编码并落到被跟踪的 `pic/readme/hero-agent.gif`
     （4.3 MB → 2.9 MB），同时去掉文件名里误导性的 `codex`。
  2. 原 README 文案称「real Codex session / five consecutive codex exec trials (3–7)」，
     与证据矛盾：宿主实为 **codebuddy**，Codex 路径因账号配额未用；证据里也没有 trial 3–7
     的记录（只有单次 `hero-codebuddy-trial.jsonl`）。文案已按证据改写。
- `pic/readme/agent-operations-live-workflow.gif` —— 真实录屏：外部 Agent 会话通过 Flovart CLI
  创建项目与节点、连接节点，可见 Workflow 实时更新。记录见 [DEMO_RECORDING.md](./DEMO_RECORDING.md)。
  现展示于 README Architecture 段，作为操作级视角。
- `pic/readme/agent-operations-final-state.png` —— 上述录屏的终态静帧，GIF 加载失败时的降级素材。
  （2026-09-19 起，原先的 `pic/readme-skill-home.png` / `pic/readme-skill-detail.png` 已随内置
  Agent + Skill 一并移除，不再作为 README 素材。）
- `pic/readme/features/*.gif` —— **功能演示组（Demo D，2026-09-18）**，README 新增
  「Feature tour / 功能演示」章节内嵌。每条一个操作，均由 `scripts/record-feature-clips.mjs`
  在真实 UI 上驱动并录制，共 20 条、合计 12.2 MB：
  - 画布：`canvas-add-node`、`canvas-connect`、`canvas-drag`、`canvas-tidy`、`canvas-prompt`
  - 图片节点：`crop`、`rotate`、`split-grid`、`filter`
  - 视频节点：`video-trim`、`video-av-split`、`video-merge`、`extract-first-frame`、`extract-last-frame`、`extract-frame-at`
  - 音频节点：`audio-trim`、`audio-speed`、`audio-stem-split`
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
4. **视频与音频节点工具：缺陷已修复，9 条片段已补录**。原缺陷有三处叠加：core 指到了
   *umd* 构建（umd 无默认导出，而 `@ffmpeg/ffmpeg` 固定以模块 worker 启动，必然抛
   `failed to import ffmpeg-core.js`）；多线程分支向 `@ffmpeg/core` 索取只存在于
   `@ffmpeg/core-mt` 的 `ffmpeg-core.worker.js`（404）；以及 `@ffmpeg/ffmpeg` 被 Vite
   预打包后 `new Worker(new URL('./worker.js', import.meta.url))` 解析到不存在的
   `/node_modules/.vite/deps/worker.js`（404），使 `ffmpeg.load()` 永不 settle、工具静默卡死。
   三处已修（`services/ffmpegClient.ts` + `vite.config.ts`），视频与音频共 9 条片段已录成，
   每条的 `operation outcome` 均为 `committed`。详见 [DEMO_RECORDING.md](./DEMO_RECORDING.md)。
   注意：这些片段的时长**不代表首次使用等待**——录制前会预热 ffmpeg core，该点已在登记中声明。
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
