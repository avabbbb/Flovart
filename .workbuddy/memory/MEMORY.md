# Flovart 项目长期备忘

## 架构关键事实（2026-06-17 摸底）

- **状态管理**：`boards`（Board[]）和 `selectedElementIds` 都在 `App.tsx` 的 `useState` 里，不在 zustand store。`useWorkspaceStore` 只管 themeMode/language。
- **Board 数据结构**（types/index.ts）：`{ id, name, elements: Element[], edges: CanvasEdge[], history: Element[][], historyIndex, panOffset, zoom, canvasBackgroundColor }`。edges 字段已加，不进 history。`CanvasEdge = {id, source, target}`，source=上游，target=下游。
- **持久化**：Board 通过 localforage 加载（App.tsx line 419 setBoards(loadedBoards)）。
- **KonvaCanvas**（437行）：纯渲染组件，props 传入 elements/selectedElementIds/回调。结构 `Stage > 背景Layer + 元素Layer`。选中态用 `stroke="#19c8b9"`。
- **AgentChatPanel**（521行）：单 Agent，通过 `buildAgentAtomicPlan` 生成 `element.create/update-prompt/ignite` 原子命令操作画布。**不感知 selectedElementIds**，产物是独立新建元素，无连线。
- **App.tsx 4613 行巨石组件**，几乎所有状态和操作都在里面。改造画布相关功能要在里面穿针引线。

## 竞品 infinite-canvas UI/UX 评估结论

对手 star 多的主因是社区分发（LinuxDO OAuth + QQ群 + 爱发电 + 配套项目互导），不是代码差距。但 UI/UX 有 6+5 项可学：
- **节点连线**（高价值）：端口、显式边、生图自动连线、上下游高亮。对手节点只有3类（图片/文本/生成配置节点），配置节点是枢纽。
- **Agent**（高价值）：选中节点即上下文、上游自动纳入、产物插回画布+自动连线、重试回答。
- **致命依赖**：Agent 上游感知 + 产物连线 依赖 节点边 先落地，两者必须捆绑做。
- **不新增节点类型**：配置节点能力（provider/model/aspect/batch 等参数）早已内嵌在 `ElementGenerationState`，挂在 `CanvasElementBase` 上，任何元素都能携带。真实差距只是"生图没读 edges 上游"。数据流方案：选中节点=配置节点角色，上游边=数据源，图片/视频上游作参考图、文本上游拼 prompt，结果图带 generationState 自动建边。`getUpstreamIds` 递归返回整条上游链路。`buildPromptPayload` 已预留 `graphInputs` 参数。

## 用户决策（2026-06-17）

- 不加生成配置节点类型；配置节点能力（参数+上游读取+批量）直接做进现有图片/视频节点的 generationState + edges 数据流（方案 B + B1 合并去重）。
- 连线方式：hover 出端口，任意方向拖出贝塞尔边。
- 连线 + Agent 改造一次性全做。
- 保持现有 UI 风格（动森/ISL 主题，--isl-* 变量）。
- 用户态度："别管那么多，优化 UI 就完事"——倾向少反问、快动手。
