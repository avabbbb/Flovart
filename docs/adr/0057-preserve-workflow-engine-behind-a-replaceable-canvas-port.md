# 在可替换画布端口后保留 Workflow 引擎

当前阶段保留 Flovart 自研 Workflow 画布，不因参考项目使用 React Flow 或其他引擎而重写节点、连线、选择、历史、Provider 或项目数据。Workflow Draft、Draft Action、节点注册表和媒体操作必须保持引擎无关；画布层只通过 Canvas Engine Port 承担视口、坐标、命中测试、选择和手势。

当前 Adapter 继续采用适合媒体工作区的混合渲染：DOM 承载可交互图片、视频和展开的 Operation Node，SVG 承载连线与白板几何，现有 HTML Overlay 承载 PromptBar 与工具栏；大型项目通过视口裁剪、媒体代理、屏幕尺寸驱动的 LOD 和仅激活视频挂载控制成本。图片与视频本身必须可直接命中并稳定挂载 PromptBar 与 ElementToolbar。

Operation Node 使用语义 LOD：运行中、失败、待确认、最近修改、选中或用户固定的节点保持完整卡片；稳定完成的简单步骤才可在低缩放级别折叠为可命中的连线 chip，并至少显示操作名、状态、Take 数和警告。错误与待确认状态不因缩放隐藏，用户可以单节点固定展开或全局展开；折叠状态只属于视图，不改变 Workflow Draft。

Agent 不直接决定绝对画布坐标，而是提交 Workflow Layout Intent，例如相对来源、方向、分支和分组。当前 Canvas Adapter 的确定性 Layout Planner 使用真实节点尺寸、折叠状态、视口与占用区域寻找空位；人工拖动后标记为 pinned 的节点不被 Agent 移动。布局结果作为可撤销 Draft Action 保存，但不进入 Operation Recipe Hash 或 ProductionSpec Revision；只有用户显式请求整理选择区域时才允许重排未固定既有节点。

只有在完成这些优化后仍无法达到明确性能预算，或协作、子图、自动布局等能力的长期维护成本持续高于适配成本时，才新增其他画布引擎 Adapter。替换 Adapter 不得迁移业务数据、改变 Provider 契约或合并 Workflow、Table、Agent 的图语义。
