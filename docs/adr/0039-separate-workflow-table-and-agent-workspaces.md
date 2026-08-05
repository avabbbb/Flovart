# 分离 Workflow、Table 与 Agent 工作区

Flovart 的主体由三个边界清晰的工作区组成：Workflow 负责提示词、参考素材、模型配置、生成依赖、任务状态与结果节点；Table 使用独立的有向节点图处理媒体预处理和故事版组织；Agent 把线程、上下文、状态与产物组织为空间面板。三者共享 Provider、Artifact 与产品模型语义，但不共享节点类型、图状态或交互语义；已删除的 Canvas / Art 不得恢复成第四部分。

浏览器业务数据默认通过 `localforage` 持久化，媒体 Blob 使用独立 store；`localStorage` 只保存极小的同步 UI 配置。Desktop 或已配对 Web 项目由 Local Data Service 作为数据权威，Browser Workspace 与 Local Data Service 之间只能显式转移，不允许跨 origin 假定共享、双写或静默合并。Provider Secret 分别受浏览器密钥边界或系统凭据库保护，不进入项目图。

Workflow 调用方通过统一 Draft Authority Port 访问当前权威，Browser Adapter 与 Desktop Adapter 不能同时挂为写端。首个 AI 原生图片 tracer bullet 允许 Browser Adapter 先行，但该先后顺序不改变显式转移和单一 Authority 的长期边界。

工作区间只通过类型化引用和显式用户动作交换 Artifact：Table 产物可以作为 Workflow 参考输入，Agent 可以通过受限工具操作对应工作区，但 Table 节点不能混入 Workflow，Agent 空间画布也不能复制生成编排语义。

媒体工具按交互复杂度而不是按“AI/非 AI”分层：单步、局部、立即服务下一次生成的操作可以作为 Workflow Operation Node；批量、多步骤、多输入/多输出、时间轴精修和可复用处理链进入 Table Processing Graph。两边共享 Media Operation Recipe Schema 与执行器，但各自拥有节点实例、历史和布局，不进行跨工作区双写。

Operation Capability Registry 为每项能力明确 `workflow-inline`、`table-only` 或两者适用的产品边界；适用性、输入输出和参数控件不能由工具栏、Agent Prompt 或 Production Skill 各自猜测。两边可以复用同一能力定义和执行器，但实例仍分别归各自工作区所有。

Workflow 操作升级为复杂处理时执行显式 Table Promotion：创建拥有独立图与历史的 Table Session，并把该分支后续配方编辑权交给 Table。Workflow 只保留带 `tableSessionId` 与已发布 `artifactId` 的可点击引用步骤；Table 中间结果不会实时覆盖 Workflow，只有用户或 Agent 明确“发布到 Workflow”才切换引用。该交接牺牲双向即时编辑，换取单一权威、可理解撤销和稳定来源关系。
