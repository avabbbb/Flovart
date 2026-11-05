# Flovart Agent 与画布能力 vs LibTV

日期：2026-11-04

依据说明：Flovart 一侧来自本仓库代码与测试；LibTV 一侧仅来自 B 站三条视频的标题与简介，以及三篇第三方文章，未核实官方文档。标注“未核实”的条目不应作为产品决策的唯一依据。

## 一、本轮改动（借鉴 omp）

- 工具失败结构化：预期失败返回 {ok:false,error:{code,message}}，details.isError 由 afterToolCall 映射为 isError，不再 throw。模型可按错误码决定改写、重试或停止。
- 长任务进度：execute 透传 onUpdate，Node 内核经 SSE tool-update 推送，浏览器内核经 tool_execution_update 推送，面板更新工具行详情。
- 任务清单 flovart_todo：两个内核都内置，不走 callCommand、不计费；整单提交，最多 20 项、同时最多 1 项 active、blocked 必须带 note。面板显示 AgentTodoCard，会话恢复和切换时从快照重建。
- 两个内核的系统提示词第 6 条一致：多步制作先建清单；预算不足或会话暂停不得重试。

## 二、Agent 能力对比

| 维度 | Flovart 现状 | LibTV（未核实） | 差距判断 |
|---|---|---|---|
| 对话驱动创作 | Node 内核 5 个公开工具 + todo；浏览器内核（Web 模式仅 Workflow 节点工具） | 自然语言一句话出片 | 表达层相当，端到端自动化弱于对方 |
| 任务可见性 | 本轮新增 todo 清单 + 工具进度 | 制作进度可见（未核实形式） | 已补齐 |
| 失败处理 | 结构化错误码；失败只重跑失败节点 | 不详 | decideRetry 仍为规划层，未自动串联 |
| 费用控制 | 会话预算 session-budget；批量一次确认 | 积分制（第三方文章） | Flovart 更透明 |
| 批量挑选 | batch.pick 仅可信本地通道 | 自动抽卡挑选（未核实） | Web 与托管通道不可用 |
| 风格沉淀 | Production Skill、对话转 Skill、制作圣经 | 模板/风格库 | 相当，我们可编辑性更强 |
| 会话控制 | abort、会话切换、快照恢复 | 不详 | steer/followUp 尚未暴露到 UI |

## 三、画布能力对比

| 维度 | Flovart 现状 | LibTV（未核实） | 差距判断 |
|---|---|---|---|
| 节点画布 | Workflow 节点（生成、video-merge 等），节点来源标记 | 无限画布 + 节点串联 | 形态相当 |
| 故事板 | WorkflowStoryboard（未做浏览器实测） | 分镜故事板 | 需实测 |
| 拆镜与拼接 | shotAssembly 纯函数 + video.merge@1 | 自动拆镜、生成、拼接（视频简介） | 最大差距：未串成一键流程 |
| 交付 | 交付契约 delivery.js、交付链接 | 导出成片 | 相当 |
| UI 本地化 | 节点工具栏、默认标题未完全英文化 | 不详 | 待清理 |

## 四、结论与下一步

1. 最大差距是“拆镜→生成→重试→拼接”没有一键串联。下一步恢复 workflow.shots.produce：生成 → decideRetry（按本轮结构化错误码）→ planAssembly → video.merge，接入会话预算，并用 todo 清单展示每镜状态。
2. 补 steer/followUp 的 UI 入口，让用户在长任务中途纠偏。
3. 故事板与冷启动超时做真实浏览器实测；演示实跑需 RunningHub 确认。
4. LibTV 对比项在拿到官方文档或实际试用后复核。
