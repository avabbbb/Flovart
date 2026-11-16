# 设计参考登记 · Flovart

每个借了外部作品的部件登一行：部件、代码位置、参考出处（URL + 作者）、拿了什么 / 没拿什么、登记日期。
新部件落地时同一个提交里补这一行；不知道出处的写「未记录」，不要猜。用户截图写上传文件名（项目 `files/uploads/`）。

| 部件 | 代码位置 | 参考（URL · 作者） | 拿了 | 没拿 | 日期 |
| --- | --- | --- | --- | --- | --- |
| 放大的资源窗口（Skills / 历史 / 素材库） | `components/studio/StudioHub.tsx`、`styles/studioHub.css` | 用户截图 `image-07a477a05144.webp`；磨砂质感 https://www.inspora.design/posts/bleep-app · Rolando | 左侧栏 + 子项、卡片网格、搜索 / 排序 / 筛选胶囊；半透明强模糊窗口（`--flv-frost-*`），窗外深色遮罩（`--flv-scrim`） | 截图里的营销横幅、Hub 字样；白色蒙层；不透明窗口底 | 2026-11-16 |
| Skill 浮层（综合 / 喜欢 / 我的、创建 ▾、悬停预览） | `components/agent/ProductionSkillDeck.tsx`、`components/agent/skillHubParts.tsx`、`styles/skillHub.css` | 用户截图 `image-08830b85f578.webp`；行内状态 https://www.inspora.design/posts/ai-agent-dashboard · Bence Redmond (@BenceRedmond) | 标题 + 搜索 / 创建 / 更多、三个分组、左侧悬停预览卡；凸起图标方块、✓ 已添加 / 「+」 | 截图里的外部品牌与配色；dashboard 的小组件拖拽 | 2026-11-16 |
| 磨砂浮层配方 `--flv-frost-*` | `styles/skillHub.css`（`.flv-frost`） | https://www.inspora.design/posts/bleep-app · Rolando | 半透明着色 + `blur(28px) saturate(175%)` + 内高光；背后文字必须糊到读不出 | 原作的彩色光斑背景 | 2026-11-16 |
| @ 引用浮层（键盘导航、实时筛选、预览卡） | `components/agent/AgentReferencePreview.tsx`、`components/agent/pickerNavigation.ts` | 用户截图 `image-f08f600abdc2.webp` | 分组列表 + 右侧预览、↑↓ / Enter / Esc | 截图应用的图标集 | 2026-11-16 |
| 执行计划卡（flovart_todo） | `components/agent/AgentTodoCard.tsx`、`styles/state.css` | https://www.inspora.design/posts/agent-plan · Jeet | 外灰壳 + 内白卡、虚线分隔、右侧状态胶囊、等宽步数胶囊、头部状态文案、当前步展开说明 | 逐步批准 / 跳过、Approve all、Run plan（后端无此路径）；原作的绿 / 琥珀配色（改用 DESIGN §11 状态色） | 2026-11-16 |
| 切换画布冲击波揭示 | `components/studio/canvasSwitchTransition.ts`、`styles/canvasSwitch.css` | https://www.inspora.design/posts/theme-for-claude-code · Marko Vineli | 从点击点整面换肤、强调色描边环 | 原作的终端主题内容 | 未记录 |
| 工具调用步骤卡 | `components/agent/AgentToolSteps.tsx`、`components/workflow/WorkflowAgentMessages.tsx` | https://www.inspora.design/posts/sandbox-boot-sequence · Jeet | 启动清单式逐行状态 | 未记录 | 未记录 |
| Agent 工作中光球 | `components/agent/AgentWorkingOrb.tsx` | https://www.inspora.design/posts/5-8 · Jakub Antalik（npm `thinking-orbs`，MIT） | 九种状态的球体动效，动效只在球里 | 未记录 | 未记录 |
| 节点生成加载（网格揭示 + 进度线） | `components/workflow/WorkflowGenerationLoader.tsx`、`components/workflow/generationLoader.ts` | 网格 https://www.inspora.design/posts/1-46 · Swami；进度线 https://www.inspora.design/posts/1-48 · Jeet | 圆角小方块按真实阶段 2×2 → 4×4 → 8×8；3px 胶囊细线 + 前沿圆点，只用真实百分比 | 假进度 | 未记录 |
| Agent 面板（整体版式） | `components/agent/FlovartAgentPanel.tsx`、`styles/agentPanelLibtv.css` | 未记录 | 未记录 | 未记录 | 未记录 |
| Composer 输入框 | `components/agent/FlovartAgentPanel.tsx`、`styles/agentComposer.css` | 研究过 https://www.inspora.design/posts/ai-prompt-bar · Alex Socoloff；是否采用未记录 | 未记录 | 未记录 | 未记录 |
| 批量结果斜叠卡片 / 网格 | `components/workflow/WorkflowAlternatesStack.tsx`、`components/workflow/batchStackMotion.ts` | 未记录 | 未记录 | 未记录 | 未记录 |
