# README asset audit

审计时间基准：本轮 README Launch Pack 开始前。目的只有一个：在新增 `pic/readme/` 动态素材之前，先确认 `pic/` 里哪些文件仍被引用、哪些没有被引用，避免「顺手删素材」造成历史链接失效。

## `pic/` 现状

| 文件 | 大小 | 被 README 引用 | 引用位置 |
| --- | --- | --- | --- |
| `pic/LOGO_optimized.png` | 1.63 MiB | 是 | `README.md:2`、`README.zh-CN.md:2`、`README.en.md:2` |
| `pic/readme-skill-home.png` | 124 KiB | 是 | `README.md`、`README.zh-CN.md`（Production Skill 两联图） |
| `pic/readme-skill-detail.png` | 158 KiB | 是 | 同上 |
| `pic/WorkFlow.png` | 598 KiB | **否（本轮移除引用）** | 原 `README.md:48`；已被 `pic/readme/agent-operations-live-workflow.gif` 取代 |
| `pic/flovart-app-home.png` | 108 KiB | 否 | — |
| `pic/flovart-workflow-empty.png` | 76 KiB | 否 | — |
| `pic/flovart-initial-state.png` | 1.05 MiB | 否 | — |

未引用合计约 1.82 MiB。

`pic/WorkFlow.png` 的处理说明：动态录屏已经展示了同一块 Workflow 界面，且能证明「操作 → 画布更新」这件静图证明不了的事；同时保留两张大图会把首屏拉得过长。文件保留不删，随时可以换回来。

## 结论

- 3 个文件仍在用，**不要动**。
- 未引用的资产本轮一律**不删除**。它们可能仍被 `docs/`、`dist-*`、其他分支或外部文章引用；删除与否应由后续单独决定。
- `pic/flovart-workflow-empty.png` 与 `pic/flovart-initial-state.png` 属于「未命名工作流 / 初始态」画面。按项目规则，空白或未就绪画面不得作为核心展示，所以它们本就不适合进首屏——这解释了为什么没有被引用。

## 需要本地 Agent 补充的动作

1. 全仓核对未引用资产是否被 `docs/`、`.github/`、`dist-studio/`、`integrations/` 或历史 release 说明引用：

   ```bash
   grep -rn "flovart-app-home\|flovart-workflow-empty\|flovart-initial-state" \
     --include="*.md" --include="*.mdx" --include="*.html" --include="*.json" . \
     --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.tmp
   ```

2. 若确认无引用，把结论写回本文件（在下方追加一节 `## Deletion decision`），**不要直接删除**；等用户明确同意后再动 `git rm`。
3. 新增的 `pic/readme/` 资产全部登记到本文件，格式与上表一致。

## `pic/readme/`（本轮新增）

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `agent-operations-live-workflow.gif` | 1.83 MiB | README 内嵌。真实运行的录屏，见 [DEMO_RECORDING.md](./DEMO_RECORDING.md) |
| `agent-operations-live-workflow.mp4` | 298 KiB | 同一段的高清母版，供 X / Reddit / docs / Release note 复用 |
| `agent-operations-final-state.png` | 171 KiB | 录屏终态静帧（三图层 + 两条连线），GIF 加载失败时的降级素材 |
| `social-preview.png` | 335 KiB | 1280 × 640 社交预览，由真实截图 + logo 合成 |
