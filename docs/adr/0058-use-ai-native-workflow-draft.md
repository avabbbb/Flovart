# 以 AI 原生 Workflow Draft 驱动画布

执行批准前，设计师与 Flovart Agent 通过同一套类型化 Workflow Draft Action 直接修改同一张可撤销画布。节点、连线、提示词、参考素材、模型参数、生成动作和画布内二次处理步骤都必须作为耐久、可见、可继续编辑的前端状态存在；AI 不能只在后端生成结果，再把图片或视频上传成没有过程记录的节点。

所有留在 Workflow 的单步结果型操作统一建模为“输入媒体 → Workflow Operation Node → 输出媒体”。Operation Node 保存操作类型、Prompt、参数、产品模型意图、输入角色与任务/Artifact 引用，允许编辑后重跑并生成新的 Take；裁剪、放大或简单剪辑等操作不得原地覆盖源媒体。画布采用自适应展开：运行中、失败、待确认、最近修改、选中或固定的节点显示完整卡片，稳定完成的简单步骤才可随缩放折叠成带名称、状态、Take 数与警告的连线 chip；折叠只是视图状态，不能把配方降级成不可编辑历史、隐藏错误或变成媒体节点内部版本。批量、多步骤、多输入/多输出、时间轴精修与可复用处理链由独立 Table Processing Graph 承担；两边只共享 Media Operation Recipe Schema 和执行器，不共享节点实例。

每个结果型 Operation Node 持有唯一 Operation Prompt Document，包含可编辑文本、富文本结构和带稳定对象 ID、输入角色与顺序的 `@` 引用。现有 PromptBar 是该文档的唯一通用编辑表面，Agent 与设计师通过相同 Draft Action 修改；不新增 InlinePrompt/NodePrompt，也不在输出媒体或聊天中保存会漂移的 Prompt 副本。Prompt 语义变化更新 Recipe Hash，并只使当前 Operation 及受影响下游重新预览和授权。

PromptBar 的 `@` chip 与画布输入边统一投影自 Operation Input Binding，Binding 保存稳定 ID、来源节点/Artifact、目标 Operation、输入角色与顺序。从 PromptBar 添加、排序或替换引用、从画布连接或改角色、以及 Agent 调整输入，都修改同一 Binding 并同步另一视图；替换只改变当前目标 Binding 的来源，保留其 ID、角色和顺序，不修改共享源节点或其它下游。不再并行维护 mention/reference/order 数组与无语义 connection，也不允许有 `@` 无边或有边无输入角色。

每个 Workflow 节点在项目内取得按媒体类型单调分配、永不重排且永不复用的 Stable Node Alias，例如 `图片1`、`图片2`、`视频1`。它是默认显示名和稳定 `@` 解析键；用户自定义标题后，两者继续指向同一节点。打开或导入纯文本旧 Prompt 时，只对唯一精确命中的稳定别名、唯一自定义标题或素材别名执行幂等水合；若唯一命中的是尚未出现在画布上的素材库资产，则先物化可见引用节点再建立 Binding。歧义或不存在的名称保留为普通文字并提示，禁止模糊猜测和隐藏媒体输入。

AI 与前端只能创建 Operation Capability Registry 中已注册的操作。Registry 为每项能力提供版本化输入/输出角色、Recipe/参数 Schema、执行类别、费用与确认级别、Workflow/Table 归属和 UI 控件 key；Agent tool schema、工具栏、Dispatcher、Preflight 与测试从同一来源生成。V1 不允许 Production Skill 或模型通过任意 JSON、HTTP 或脚本临时扩展操作面，避免 AI 能力、可编辑 UI、权限和费用边界再次漂移。

Flovart Agent 通过迭代 Workflow Agent Tool Loop 直接操作 Draft：读取当前状态、调用一个 Registry 工具、观察新的 Draft/Object Version 和执行结果，再决定下一步；一个用户回合归入一个 ChangeSet。循环具有步数/时间上限、取消、steer、对象冲突和授权暂停，部分失败保留现场。长时 Provider 任务返回持久句柄并由 Runtime/Workspace 观察，只有授权、冲突或 Intervention Event 恢复 Agent；不使用一次性 JSON 命令批次，也不让模型持续轮询。

每次执行还要冻结不可变 Execution Prompt Snapshot，绑定源文档 Hash 并记录实际发送的最终文本、引用绑定、规范化参数和编译器版本。Prompt 增强、翻译、模板或 Provider 适配只能形成可查看差异，不能静默覆盖 Operation Prompt Document；设计师或 Agent 明确“采用到 PromptBar”时，才以新 Draft Action 更新可编辑意图。Operation Take 引用该 Snapshot，使任一结果都能解释和复现实际输入。

每个 Operation Take 绑定启动时的 Recipe Hash、ProviderAttempt、费用状态与 Artifact。Operation 运行中被编辑时，旧 Recipe 的晚到结果不得丢弃或自动挂为当前输出；它作为“旧配方结果”留在 Take 列表，只有用户或 Agent 明确采用时才通过新的 Draft ChangeSet 更新 `selectedTakeId` 并影响下游。

创建、更新、连线、移动、调参以及可恢复删除等草稿动作默认立即执行、耐久提交并实时渲染。一个 Agent 回合或一段连续人工手势归入一个语义 Draft ChangeSet，记录操作者、意图、类型化动作、受影响对象、前后差异、执行结果以及关联的 Operation Node、Provider Task 与 Artifact。Agent 多步执行部分失败时不回滚或隐藏已成功步骤：ChangeSet 标记为 `partial`，失败 Operation Node 保留完整 Recipe、错误和重试入口；按组撤销只移除 Draft 图变更，不伪造删除已发生的 ProviderAttempt 或 Artifact。完整快照只用于检查点，不取代可理解历史。付费 Provider 提交、冻结 ProductionSpec Revision、发布和不可恢复动作才进入确认 Gate。

Workflow Workspace 同时提供画布与 Draft Change Timeline：画布呈现当前图，时间线按 ChangeSet 显示谁为什么改了什么、状态、差异摘要以及费用/Artifact 关联。时间线记录可聚焦受影响节点，节点检查器可反查来源 ChangeSet；Agent 聊天只链接这些记录并负责解释，不成为唯一操作历史。

设计师与 Agent 使用对象级乐观并发，而不是锁定整张画布或最后写入覆盖。每个 Draft Action 携带 `baseDraftVersion` 与目标节点/连线的 `expectedObjectVersion`；版本不匹配时返回 `PRECONDITION_FAILED`、冲突对象和当前版本。Agent 只重新读取并重算相关子图，互不相关动作继续提交；人工刚完成的 Prompt、参数或连线不会被旧 Agent 快照静默覆盖。

Agent 创建节点时只提交 Workflow Layout Intent，不猜测绝对坐标；前端 Layout Planner 按真实尺寸和空闲区域生成可撤销布局。人工拖动的 pinned 节点不会被 Agent 或每回合自动布局移动，纯布局变化也不使 Operation Recipe、授权或 ProductionSpec 失效。

纯 Web 项目的 Workflow Draft 与 ChangeSet 由 Browser Workspace/localforage 保存；Desktop 或已配对 Web 项目由 Local Data Service 保存。同一项目一次只能绑定一个 Workflow Draft Authority，切换必须显式导出、校验、导入和确认，禁止双写或静默自动合并。

UI、Agent、Dispatcher 与 Draft Change Timeline 只通过 Workflow Draft Authority Port 读写 Draft、ChangeSet、Binding、Take 和布局。首个图片 tracer bullet 先交付 Browser Workspace/localforage Adapter，以最快验证当前可见画布；Desktop Adapter 后续实现相同契约，不能为赶进度在 Browser store 与 Runtime 之间增加双写。Browser 页面关闭后不能继续 Agent 草稿操作的限制必须如实呈现。

用户确认制作方案时，当前 Draft 才冻结并编译为不可变 ProductionSpec Revision，再由 Production Mandate 对其中精确 Authorized Operation Subgraph 一次授权。未授权的新节点不能继承会话预算；运行中的语义调整从已批准 Revision 派生新 Draft，重新批准后只使改动节点及受影响下游失效，并保留其他已授权执行与旧 Artifact。Production Plan Projection 只把 StageRun、Artifact、费用和审批状态同步回工作区，不能覆盖正在编辑的 Draft；纯布局变化也不产生新的 ProductionSpec Revision。
