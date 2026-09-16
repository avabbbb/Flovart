# GitHub metadata

本文件记录仓库展示面的设置口径。**About 与 Topics 已应用**；Social preview 因 GitHub 无公开上传 API，仍需人工上传。

## About description

当前值（已应用）：

> Open-source agent-native visual production workspace where humans and coding agents edit the same live canvas — local-first, BYOK image/video models.

应用方式：

```bash
gh api -X PATCH repos/avabbbb/Flovart \
  -f description="Open-source agent-native visual production workspace where humans and coding agents edit the same live canvas — local-first, BYOK image/video models."
```

回滚旧值（应用前的原文）：

> Flovart 致力于补充画布自动化领域的缺失。它支持Claude Code、Codex等，让用户能够使用自己的第三方 API Key（如 seedance、banana2、gpt-image-2）来编排自定义视觉工作流，同时提供一种高级的、灵感来自lovart 的设计界面，方便用户日常使用。

旧值被替换的原因：原描述是中文长句，且把「灵感来自 lovart」和具体第三方模型名放在对外门面上；对英文为主的访客不够直接，也没有说清「人类与 Agent 操作同一份画布」这个真正的差异点。

## Topics

已应用（16 个，上限 20）：

```text
agentic-ai          ai-agent            ai-image            ai-video
aigc                byok                claude-code         codex
creative-tools      generative-ai       infinite-canvas     local-first
node-editor         opencode            visual-workflow     workflow-automation
```

应用方式：

```bash
gh api -X PUT repos/avabbbb/Flovart/topics \
  -f names[]=ai-agent -f names[]=agentic-ai -f names[]=generative-ai -f names[]=aigc \
  -f names[]=ai-image -f names[]=ai-video -f names[]=visual-workflow -f names[]=workflow-automation \
  -f names[]=infinite-canvas -f names[]=local-first -f names[]=byok -f names[]=codex \
  -f names[]=claude-code -f names[]=opencode -f names[]=creative-tools -f names[]=node-editor
```

应用前为**空**。

**不要添加** `premiere-plugin` / `after-effects-plugin` / `davinci-resolve`：这些能力在 `SUPPORT_MATRIX.md` 中仍是 Experimental / Planned，Topic 会让人误以为已认证。等真实宿主 tracer 通过再加。

## Social preview

目标文件：`pic/readme/social-preview.png`

- 1280 × 640，约 335 KiB（GitHub 上限 1 MiB）；
- 由真实 `pic/WorkFlow.png` + `pic/LOGO_optimized.png` 合成，**不是 AI 生成图**；
- 生成脚本 `.tmp/render-social-preview.mjs`（一次性本地工具，不进 build、不提交）。

GitHub 没有上传 social preview 的公开 API，只能人工操作：

```text
仓库页 → Settings → Social preview → Edit → Upload an image… → 选择 pic/readme/social-preview.png
```

上传后验证：在 Slack 或 X 里贴一次仓库链接，确认卡片渲染正常；若被缓存，用 Facebook Sharing Debugger 的 Scrape Again 刷新。

参考：[GitHub repository topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics) · [GitHub social preview guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)
