# Flovart：创作宿主与 Agent 协作设计

这是当前唯一的产品与系统主设计。它替代旧 Agent 分层设计、Link 目标稿和 Production Runtime V1 扩张计划；旧代码不会因文档改写自动完成重构。术语见[领域词](../maintenance/agent/CONTEXT.md)，可用性见[支持矩阵](../../SUPPORT_MATRIX.md)，实施进度见[待办](../content/docs/progress/todo.mdx)。

## 1. 决定与边界

| 项目 | 决定 | 依据 |
| --- | --- | --- |
| 第一宿主 | **DaVinci Resolve Studio 21.1 first**；先验证官方 native MCP + Flovart Skill 的真实闭环 | 用户 2026-09-25 确认 |
| 产品入口 | 外部 Agent 与 Resolve 21.1 native MCP 负责宿主操作；Flovart 轻面板负责上下文、生成、候选与确认；复杂编排再展开 Flovart | 用户确认 + 21.1 新能力 |
| AE / PR | 保留现有 Experimental 实现与证据，暂停作为首个交付阻塞项；Resolve 纵向切片跑通后再恢复 | 用户确认 |
| 首版平台 | Windows 优先；macOS 后续单独验证，不承诺同期支持 | 用户通过 ASK 确认 |
| 首个核心能力 | 当前 Resolve 选中片段 → Flovart 生成固定候选 → **非破坏性导入 Media Pool** | 用户确认 |
| Timeline 写入 | P1 才允许“添加到新轨道”；P2 才做显式 Replace/Commit，并在提交前重新确认目标身份 | 风险分级 |
| OFX / 原生效果 | Resolve OFX 后置；只有固定版本参数、关键帧或离线渲染出现真实需求后才进入首版 | 用户确认 |
| Agent | 外部助手优先；Flovart Skill 教 Agent 同时使用 Resolve native MCP 与 Flovart CLI；不复制第二套 Resolve MCP | 用户确认 |
| 复杂度 | 官方宿主能力优先；普通函数直接完成业务，不增加强制 Operator、制作组、通用总线或“每个 Resolve API 一个 Flovart tool” | 用户明确要求精简 |
| Provider / 费用 | Resolve 不保存 Provider key；付费生成仍由 Flovart 计划/费用边界控制 | 现有安全边界 |

本主设计定义产品目标与边界。Resolve 21.1 的具体 MCP tool 名、数量和 Scripting API 以用户机器上的实际 Studio 版本为准，不把社区实测细节冻结成产品 contract。实现进度仍以待办、待测试确认和 Support Matrix 为准。

## 2. 产品设计

一句话：**在 Resolve 里选中一个片段，让自己的 Agent 调用 Flovart 生成一个新版本，审核后安全地送回 Media Pool；复杂制作再展开 Flovart。**

首批用户是使用 DaVinci Resolve Studio 21.1 做短视频、广告和创作者内容的个人剪辑师。首个任务不是“让 AI 自动剪完一条片”，而是把一个明确的当前片段变成一个可审核、可追踪、不会破坏原时间线的新候选。

第一阶段不要求用户安装 Flovart 自己的 Resolve MCP server。Blackmagic Studio 21.1 已提供 native MCP；Flovart 应优先利用该宿主控制面，把自己的价值放在生成、引用、持久 Artifact、版本与 Workflow 上。

产品由四个协作面组成：

- **Resolve native MCP**：宿主控制面。由外部 Agent 读取工程/选择、查询当前 Scripting API，并在受控范围内执行 Resolve 操作。
- **Flovart Resolve 轻面板**：人类审核面。只显示当前 Clip、Prompt/Reference、Plan/Cost、Task、Candidates 与 Open in Flovart，不承载完整 Agent 聊天。
- **Flovart Skill + CLI**：生成能力面。教外部 Agent 使用 Flovart 的稳定操作、生成任务、持久素材与恢复语义。
- **Flovart 工作区**：复杂 Workflow、版本比较、依赖与多镜头制作。Canvas | Table | Agent 的现有 IA 不因 Resolve 改写。

第一阶段默认动作是“生成候选并导入 Media Pool”。原 Timeline 保持不变。只有用户明确要求后，后续阶段才增加新轨道写入与 Replace/Commit。

Resolve OFX、AE/PR 原生效果、PS 滤镜继续保留为后续宿主能力，不再作为 Resolve-first Hero 的前置条件。

### 2.1 生态分发

Operation Skill 负责教外部助手组合 **Resolve native MCP + Flovart CLI**：宿主状态从 Resolve 读取，生成与 Artifact 从 Flovart 读取。Skill 不复制 Resolve 的完整 API 文档，也不把官方 native MCP 包装成第二套 Flovart MCP。

制作配方继续复用已有 Production Skill 包；配方可以描述创作方法、参考 Workflow、模型需求与结果验收，但不拥有宿主工程 truth、不包含 Provider 凭据，也不自动获得 Timeline 覆盖权限。

如果用户机器上的 Resolve native MCP 缺少某个第一阶段必需操作，先记录具体 gap、版本与复现，再决定是否复用现有 Workflow Integration bridge。不能因为“以后可能需要”而预先建设通用 Resolve Gateway。

## 3. 交互设计

Resolve 专项的完整 UI/交互规范见 [Resolve 21.1 Product & UI Spec](../../integrations/studio/resolve/PRODUCT_UI_SPEC.md)。实现 Agent 必须先读该文档，并在视觉修改前重新打开 Blackmagic 当前 Edit / Cut / Media 官方页面核对真实宿主界面。

### 3.1 首次使用

第一阶段路径：

~~~text
安装 / 打开 Resolve Studio 21.1
→ File > Setup AI Assistants
→ 验证一个真实外部 Agent 已连接
→ 打开项目并选择一个 Media Pool clip 或 timeline item
→ Agent 或 Flovart 面板读取当前上下文
→ 输入创作意图 / References
→ Flovart 显示必要的模型与费用范围
→ 提交一次生成
→ Candidate ready
→ 用户审核
→ Add to Media Pool
~~~

第一阶段到 Media Pool 为止，不自动替换 Timeline。

未检测到 Studio 21.1、没有打开项目、没有选择素材、native MCP 未连接或 Flovart 未连接时，只显示一个清楚的恢复动作。不要暴露端口、Lease、MCP JSON、Token 或内部 bridge 名称。

### 3.2 四个 Surface 各做一件事

| Surface | 内容 | 不承担 |
| --- | --- | --- |
| 外部 Agent + Resolve native MCP | 理解自然语言、读取 Resolve 上下文、查询当前 API、执行受控宿主操作 | Provider key、Flovart 任务 truth、第二份素材库 |
| Flovart Resolve 轻面板 | Current Clip、Prompt/Reference、Plan/Cost、Task、Candidates、导入动作 | Agent 全聊天、Timeline 编辑器、完整 Canvas |
| Flovart Skill + CLI | 生成任务、Artifact、恢复、Flovart operation semantics | 复制 Resolve 全量 Scripting API |
| Flovart Canvas | 多镜头、依赖、复杂引用、版本比较与 Workflow | 冒充 Resolve Timeline / Media Pool |

面板视觉以 Resolve Inspector 为主要参考：紧凑单列、当前选择优先、弱品牌、克制分隔、一个主 CTA。不要把网页首页卡片、超大 logo、复杂 tab、模型市场或系统设置塞进窄面板。

第一版面板信息顺序固定为：

~~~text
Connection
→ Current Clip
→ Generate
→ References
→ Model (Auto by default)
→ Output (Media Pool)
→ Task
→ Candidates
→ Open in Flovart
~~~

当前共享面板传入 Resolve 的 `media-pool` target，但通用 select 仍未创建对应 Media Pool option；这是待修的真实实现缺口，不得用 mock 截图掩盖。

### 3.3 版本、并发与错误

- 生成任务冻结提交时的 project / timeline / clip 或 Media Pool item 身份；用户在 Resolve 继续切换选择不能改变正在执行的目标。
- P0 Candidate 只进入 Media Pool，不删除、不覆盖、不替换原 Timeline clip。
- P1 “Add to new track”需要明确用户/Agent 指令；P2 “Replace/Commit”需要提交前重新读取目标身份并确认可恢复路径。
- 改提示词不自动花费；重复点击依赖现有幂等/任务查询，不能用第二个 id 偷偷重复计费。
- Provider 无法取消时显示“已请求取消，供应商可能仍计费”；unknown-after-submit 保留原 task identity 并查询，不重新提交。
- 外部 Agent 可以自动读取项目、选择与 API 文档；付费生成、Timeline Replace/Delete、覆盖已有导出文件等高影响动作仍按权限/确认边界执行。
- 如果 Resolve native MCP 提供 bounded 与 unsafe script 两种执行面，默认只使用 bounded path；unsafe filesystem/network escape 默认拒绝。
- 社区报告的 Windows CJK/Python UTF-8 问题必须在本机先复现，再加入兼容处理；不能未经验证把社区 workaround 写成产品依赖。

## 4. 系统设计：两条短路径

```text
生成：面板 / CLI / MCP → 同一任务函数 → 现有 Provider 适配 → 保存素材版本
渲染：宿主效果 → 读取固定素材版本 → 遮罩与混合 → 返回当前帧
```

外部 Agent 负责理解自然语言、选择工具；任务函数负责执行。Flovart 内置 Assistant 是可选的同一工具入口，不自动成为默认协作者，也不拥有绕过确认、费用或目标校验的权限。确定性命令直接调用业务函数，不再先经另一个内部 AI 重新解释。CLI + Skill 是默认外部路径，MCP 只是同一能力的可选协议投影，不串联为 MCP → CLI 子进程 → 多层代理。Link 保留为连接相关代码的名称，不发展成独立业务服务。

### 4.1 状态归属

| 数据 | 唯一保存者 | 其他入口保存什么 |
| --- | --- | --- |
| 图层、时间线、效果参数、关键帧、撤销 | PS/PR/AE/Resolve 工程 | 明确的目标引用与必要上下文 |
| 生成输入、任务状态、Provider 任务 ID、结果版本 | 本地生成服务 | taskId、进度、结果引用 |
| 已生成媒体 | 持久素材目录 | 素材 ID、相对路径、校验和 |
| Workflow 图、Table 图 | 各自现有项目存储 | 引用或显式导入的副本，不双写同一节点 |
| Agent 主会话 | 对应 Agent 宿主/官方运行时 | 非秘密会话引用、用户可见消息与任务关联 |

首个效果不强制创建 Workflow 项目、ProductionSession、ProductionSpec、StageRun 和导演绑定。复用现有任务/Artifact 记录；如果旧执行器要求额外对象，应在收敛时去掉这一依赖，不给单步效果再套一层“配方编译平台”。复杂 Workflow 继续保留其真实依赖图，不能用精简为理由取消必要的任务恢复或引用关系。

### 4.2 最小数据

下列是语义字段，不要求为每个名词建表或类；优先扩展已有 task/Artifact 结构。

| 记录 | 最少需要的内容 |
| --- | --- |
| 任务 | ID、幂等键及请求摘要、固定输入快照、目标引用、状态、Provider 任务 ID、结果引用、可解释错误 |
| 素材版本 | ID、来源任务、文件及校验和、尺寸、帧率/帧数、色彩与 Alpha 信息、配方摘要 |
| 效果实例 | 宿主保存的实例身份、已应用素材版本、源范围与时间映射、混合参数；已有宿主关键帧直接沿用 |

请求摘要包含输入文件指纹、时间范围、提示词、参考、模型与生成参数；界面布局、混合强度和关键帧不改变生成请求摘要。不同来源/参数不能复用一个幂等键。实际发给 Provider 的非秘密规范化输入需要保存，不能只存不可解释的 hash。

任务主状态：`queued → running → completed | failed | canceled`。Provider 已提交但回执丢失时标记待核实的提交状态，查询原任务；不能盲目重提。UI 关闭不取消生成，恢复只读取已有状态；首版单机顺序队列即可，不引入 Redis、消息总线或分布式工作流引擎。

### 4.3 文件与渲染

- 先下载到暂存文件，校验后原子提交到持久素材目录；文件齐全后才把任务标为完成。
- 效果保存精确版本和相对素材引用，不保存临时 URL、Blob URL、base64 或全部媒体字节。
- 素材持有工程引用时不得自动清理；保存/打包必须带上已应用版本。移动目录后提供重定位并校验内容，不能根据文件名误配。
- 渲染函数不得访问网络、等待生成或依赖 Agent、浏览器及生成服务在线。只使用固定文件和宿主当前帧参数；版本切换在宿主允许的修改时机完成并触发缓存失效。
- 生成与解码采用现有成熟库/Provider 适配。首个短片段优先验证图片序列作为随机帧读取缓存；具体库、像素格式与 SDK ABI 在原型验证后锁定，不手写编解码器。
- 统一时间使用整数帧与有理帧率；记录源入点和偏移。首版先验证固定帧率 SDR，变速、倒放、HDR、超长片段在未测前明确不支持，不静默拉伸帧数。
- 保存并验证色彩空间、Alpha 预乘方式、像素宽高比和输出尺寸；插件按宿主 SDK 的线程规则实现，多帧渲染不共享可变的“当前帧”。

## 5. 具体实现与现有代码收敛

### 5.1 当前源码事实

| 位置 | 当前可复用部分 | 尚不能宣称 |
| --- | --- | --- |
| `integrations/studio/` | 面板包、宿主资源引用、AE 原生效果源码原型及候选应用桥接；AE CEP 源码按 Workflow Artifact ID + SHA-256 命名本机素材，在候选图层注释保存版本与目标 ID，并按当前合成恢复候选列表；AE 导入后记录宿主解释的帧率、帧时长、像素宽高比、Alpha 解释和项目色彩上下文；CEP 写盘后回读暂存文件并校验字节数与 SHA-256，再重命名为固定版本路径，应用前重新校验候选素材；效果只声明已实现的像素独立能力 | 已编译原生效果、MFR 并发认证、输出范围/偏移处理、缺失素材重定位/回链、工程自包含、应用后渲染期间的文件篡改检测、嵌入素材色彩配置及权威帧数、CEP 大文件回读开销验证、真实宿主认证 |
| `services/workflowExecutor.ts`、`components/workflow/inputResolver.ts` | 统一输入与现有生成语义 | 关闭浏览器后插件独立生成 |
| `src-tauri/src/runtime/` | 任务、Provider、持久存储、本地控制服务 | 无 UI 独立启动及与所有前端 Provider 完全等价 |
| `tools/flovart/`、`agent/` | CLI、命令描述、五工具 stdio MCP、共用操作入口、当前 Browser 绑定 | 原生效果工具、真实 MCP 客户端认证 |
| `integrations/workbuddy/`、`dsh-plugin/` | 现有连接包与适配 | 双向实时对话和所有官方版本已认证 |

已看到的具体风险：PS/PR 面板仍等待注入回调；Resolve 导入文件后立即删除暂存路径，需验证宿主是否复制媒体，正式素材不能依赖这种行为。上述是代码检查所得，不代替宿主运行证据。

### 5.2 最少模块与顺序

1. **先做 AE 原生效果小样**：现有源码通过 AE 图层参数读取候选素材并暴露混合参数；下一步是接入真实 Windows AE SDK 构建与 PiPL 资源流程，再在宿主验证保存重开、随机帧和渲染。固定资产阶段不调用模型；源码和面板打包都不代表 `.aex` 已构建或宿主已通过。
2. **验证 PR 复用**：AE SDK 效果可适配 PR，但必须验证参数、像素格式、线程、时间映射和构建产物。能共用的渲染函数放同一源码文件，宿主差异留在入口；不预建通用 Host SDK。
3. **接真实生成**：优先复用现有 Rust Runtime 的任务、文件和 Provider；补无 UI 启动入口并逐项核对现有 Provider 能力。TS 的输入整理只抽离必要纯函数；不得在 Rust 与 Node 各新增一套调度器。若目标 Provider 在 Runtime 不可用，明确记录迁移缺口，不写一个新的生成网关掩盖差异。
4. **接插件面板**：面板调用同一生成任务入口，候选明确应用到效果实例。宿主 ID、撤销、参数保存和工程关闭事件由宿主入口处理。
5. **接 CLI/Skill 与 Agent**：复用现有 CLI + Skill 默认入口和共用操作入口，MCP 只作为同一能力的可选投影，不再新建第二个 MCP Server。新效果命令只有实现、schema 和验证齐备后才进入 Skill；现有工具仍按 Browser 绑定执行，不能自动变成无 UI 效果接口。
6. **再接 PS、WorkBuddy 双向、Resolve**：扩展前复用已验证的素材版本与任务函数，只增加确有差异的宿主/Agent 调用代码。

后端 Go/Gin/GORM 继续处理已有网站/社区业务，不为了本机效果增加一跳云端业务服务。Node CLI/Agent 代码可以承担协议接入；它不拥有另一份任务数据库。宿主渲染线程不进入 HTTP/Node/Rust 控制链。

单个模块只为三个理由拆分：确实复用、独立状态所有权、宿主/进程/凭据边界。仅转发参数的 Manager/Facade/Coordinator 不成立。新增层必须写明解决哪个已复现问题、替代什么旧路径；同一修改同时删掉重复实现，不能长期叠加“新旧兼容层”。

### 5.3 宿主能力

| 宿主 | 第一控制面 | Flovart UI / 深层能力 | 首次验收 |
| --- | --- | --- | --- |
| **Resolve Studio 21.1** | **Blackmagic native MCP** | 现有 Workflow Integration 轻面板后续收敛；OFX 后置 | Agent 真实连接、读取选择、Flovart 生成、durable artifact、Media Pool 导入 |
| AE | 现有 CEP/脚本面板 | C++ Effect SDK 现有 Experimental 源码保留，暂停首个 gate | 恢复时再做真实 .aex、重开与离线导出 |
| PR | UXP；仅确有需要时使用 Hybrid | 原生效果后续单独验证 | 片段范围、Effect Controls、时间线导出 |
| PS | UXP | PS C++ Filter SDK 后续 | 选区、滤镜参数、保存重开 |

Resolve Studio 21.1 是当前第一宿主。官方 support 页面在 2026-09-08 的 Studio 21.1 更新说明中列出 AI assistant integration 与 20 个新 scripting APIs；native MCP 的具体工具表必须从安装版本读取，不以第三方文章中的固定数量做兼容承诺。

现有 `integrations/studio/resolve/` Electron Workflow Integration 不删除，但它从“必须先做的宿主控制层”降为**人类轻面板 / fallback adapter**：官方 native MCP 能完成的 Agent 宿主操作不再重复建设。Resolve OFX 仍是独立后续能力，不能拿 MCP 或 Workflow Integration 的成功证明 OFX 已支持。

Premiere / AE / PS 的具体 SDK、版本与兼容边界继续以各自官方文档和真实宿主证据为准。[Blackmagic Support](https://www.blackmagicdesign.com/cn/support/)、[Resolve Edit](https://www.blackmagicdesign.com/products/davinciresolve/edit)、[Resolve Media](https://www.blackmagicdesign.com/products/davinciresolve/media)、[OpenFX](https://github.com/AcademySoftwareFoundation/openfx)。

### 5.4 Agent 双向接入

外部助手：Skill → CLI（默认）或 MCP（可选投影）→ 同一任务函数。内部任务入口：用户消息 → 可选的 Flovart Assistant → 同一批 Flovart 工具。Workflow、Table、Agent 仍是三个独立入口；选择外部 Agent 或打开内置 Assistant 都不转移工程所有权，不读取别的助手私有账号数据库；一次效果写入绑定明确目标和期望版本。

- Codex：外部沿用现有 Skill/CLI；内部通过 app-server 承接用户可见会话、事件和审批，优先本地 stdio、锁定版本。官方文档对实验性接口及 WebSocket 有限制，必须另做登录与恢复验证。[官方文档](https://developers.openai.com/codex/app-server)
- WorkBuddy：外部连接器在 CLI + Skill 与 MCP + Skill 中选择一个包形态，不能混装成同一个连接器；内部可使用官方本地助理 API，但要申请应用、scope 和用户授权，经 HTTPS 平台访问，不能宣传完全离线。本地助理状态/历史与云端 ACP 流不同，不能推断本地端支持相同流式能力。[连接器](https://open.workbuddy.cn/docs/connector)、[第三方应用](https://open.workbuddy.cn/docs/third-party-app)、[Open API](https://open.workbuddy.cn/docs/openapi)
- DSH、Claude、OpenCode 等保留已有接入，不因新效果项目改写其宿主；内置深度对话按各自官方能力另验。TeleAgent 身份未确定，暂不标支持。
- Agent 切换只交接任务目标、输入摘要、当前结果和待办，重新读取任务状态；不声称把不同助手的完整记忆或登录态迁移成功。

本地服务负责费用、目标、输入和幂等校验。Agent 工具权限不等于生成费用授权；已确认范围内执行不重复要求批准，新增费用或改变目标才重新确认。生成中断优先查询原任务，不通过“自动点击所有确认”实现无人值守。

## 6. 评测与 Benchmark

本节定义待执行评测，所有指标初始为 **未测**。测试数量与阈值是首版建议验收目标，不是现有结果或营销承诺。首个原型完成后先固定机器与 SDK，再冻结阈值；失败不得靠删样例变成通过。

首轮只统计 Windows 实测结果，明确 OS 与 AE/PR 版本；后续 macOS 重跑对应评测，不合并为无条件跨平台分数。

### 6.1 固定评测集

先建立 12 个获授权的 5 秒、1080p、固定 24 fps、SDR 片段：静物、人物运动、遮挡/细边缘、镜头运动各 3 个。每个输入配固定时间范围、提示词、参考图、人工验收要点和文件 hash。另用 4 个人工可计算的合成序列测试 Alpha、帧号、关键帧和混合像素；PS 阶段增加 6 张透明/选区/不同尺寸的静态图。

分开报告三组结果：固定素材的插件正确性、真实 Provider 的生成质量、真实 Agent 的任务成功率。Fake Provider 只验证协议与恢复，不能贡献视觉质量分数。整段替换不得按“人物完全保留”打广告；若该要求进入范围，应新增主体/背景独立指标及跟踪样例。

### 6.2 验收矩阵

| 类别 | 方法 | 建议通过线 |
| --- | --- | --- |
| 宿主正确性 | 4 个合成序列，关键帧/随机 seek/首尾帧/不同入点，与独立计算参考比较 | SDR 8-bit 每通道最大误差 ≤ 1；无错帧、Alpha 黑边；适用像素格式分别报告 |
| 持久性 | 12 个片段保存重开；关闭 Agent/服务并断网后导出 | 12/12 固定版本可重开并导出；不产生生成请求 |
| 幂等与恢复 | 双击、断连、回执丢失、进程中断、晚到结果，每类重复 5 次 | 无重复自动提交、跨目标写入或错误版本覆盖；未知提交明确待核实 |
| 版本操作 | 应用 V1/V2、撤销重做、复制效果、另存工程、移动素材目录 | 目标及素材版本正确；缺失可重定位；导出前能检测缺失 |
| 缓存性能 | 固定资产，冷启动与预热后分开记录；每宿主 3 轮 | 建议预热后单效果 1080p/24fps 播放不掉帧，调参到预览 p95 ≤ 100 ms；冷读单列不混入 |
| 资源使用 | 连续使用 30 分钟，反复切换 20 个版本 | 无崩溃、无持续无界内存增长；记录峰值内存/显存、磁盘缓存，不伪造固定硬件通用上限 |
| 生成质量 | 12 个真实片段每项 3 次；至少 2 人独立看提示遵循、可用性、时序稳定，各 1–5 分 | 建议 ≥ 10/12 样例多数尝试可用；各项平均 ≥ 4，严重时序错误单列；分歧保留 |
| Agent 成功率 | 读取正确选区、准备生成、查询、应用指定版本、断线恢复共 20 个固定任务；每 Agent 单独跑 | 建议 ≥ 18/20；错误目标/越权费用/假成功为 0；必须有工具回执和宿主结果 |
| 安装与首次使用 | 5 名未参与开发用户完成安装到首个结果；人工辅助需记录 | 建议 ≥ 4/5 无开发者介入成功；记录总时长并单列模型等待时间 |

最终成片导出与预览必须绑定相同素材版本、色彩设置和效果参数。涉及多帧渲染、GPU 或不同宿主的差异需单独复现，不能用截图主观相似替代像素/帧校验。

### 6.3 对照与记录

基线 A 为现有“生成→下载→导入→手工合成”流程，基线 B 为插件流程；同一素材、模型版本、参数、网络与机器，顺序交替。比较人工点击数、主动操作时间、失败恢复步骤和最终可用结果；Provider 等待和扣费单列，不能把不同模型速度算作插件提速。

每次保存一个机器可读结果文件：代码提交、插件构建、OS/CPU/GPU/内存、宿主/SDK/模型版本、输入 hash、请求参数、重复次数、成功/失败/未测、冷/热 p50/p95、成本与失败样例。原始记录与脱敏录屏放 `artifacts/native-effects/`，临时 profile 放 `.tmp/`；真实 key 不进入证据。

先做代表性 12 例，扩大样本必须针对具体失败模式。不要再列几十阶段通用“总门禁”。每一步只跑影响到的测试：协议用契约测试，原生效果必须进真实宿主；文档修改只跑文档和链接检查。旧 RC 数字保留其原提交证据，不能复用为新效果 Benchmark。

## 7. 宣传口径

| 场合 | 可用措辞 | 证据要求 |
| --- | --- | --- |
| 当前 README | 本地优先的 Workflow 与 Agent 创作工具，正在开发原生效果插件 | 当前支持矩阵；新方向明确标“开发中” |
| 原型展示 | Flovart 场景替换原型：生成一个版本，再在 AE/PR 中调节 | 真实宿主录屏，标注软件/插件版本和未完成项 |
| 宿主验证后 | 在 AE/PR 中生成、比较并应用素材版本，继续调整混合与关键帧 | 对应宿主实际安装、保存重开和导出通过 |
| Agent 接入验证后 | 用 Codex/WorkBuddy 完成所展示的 Flovart 任务 | 该 Agent 的真实会话、工具回执和结果；逐个声明 |
| 性能宣传 | 在指定硬件与素材规格下达到测得的播放/交互表现 | 可复跑 Benchmark，提供失败样例和条件 |

未来主文案建议：“生成新场景，继续在你的剪辑软件里精修。” 首个演示依次展示选中片段、生成等待、V1/V2 对比、关键帧调节、保存重开和导出。加速等待必须标注，不用假进度或预制输出冒充实时生成。

首版平台措辞固定为“Windows 优先，macOS 后续验证”；不得用“支持 Adobe”省略实际宿主、平台和版本限制。

禁止未验证宣称：实时 AI 视频生成、支持所有模型/宿主、人物自动完美保留、跨 Agent 无缝记忆迁移、完全离线生成、云同步已完成、一键无人值守成片。不能因为有 SDK、安装包或单元测试，就写成正式支持。

## 8. 实施里程碑与文档治理

当前实施顺序已经切换为 **Resolve Studio 21.1 MCP-first**。AE/PR 源码与研究保留，但不再阻塞第一个真实宿主 Demo。

| 顺序 | 交付 | 完成证据 |
| --- | --- | --- |
| 1 | Resolve Studio 21.1 native MCP 真实连接 | File > Setup AI Assistants 后一个真实 Agent 能读取当前项目/选择；记录安装版本与实际 tool surface |
| 2 | Resolve MCP + Flovart CLI 最小纵向闭环 | 当前选择 → 一个 deterministic/fake Flovart artifact → 正确 Media Pool 导入；原 Timeline 不变 |
| 3 | Resolve 轻面板 UI 收敛 | Current Clip → Generate → Task → Candidates → Add to Media Pool → Open in Flovart；窄/宽面板真实宿主可用 |
| 4 | 一个真实 RunningHub Provider tracer | 真实付费生成、durable artifact、取消/unknown-submit、Media Pool 导入 |
| 5 | Add to new track | 不破坏原素材；目标/轨道身份可验证 |
| 6 | Replace / Commit | 显式确认、提交前目标复核、可恢复/撤销语义 |
| 7 | Resolve OFX | 只有真实用户需求证明固定版本效果/关键帧/离线渲染必要后才进入 |
| 8 | 恢复 AE/PR 原生效果与其它宿主 | 按各自真实 SDK / 宿主证据继续，不复用 Resolve 认证 |

第一阶段不要把“做一个更大的 Resolve 插件”当作进展。优先验证官方 MCP、现有 Flovart 生成路径和 Media Pool 之间最短的真实链路。native MCP 不足时才用具体 gap 驱动现有 Workflow Integration bridge。

Resolve 面板实现必须遵循 [Resolve 21.1 Product & UI Spec](../../integrations/studio/resolve/PRODUCT_UI_SPEC.md)。视觉参考优先 Blackmagic Edit / Cut / Media / Inspector；社区 MCP 面板只用于失败恢复和 observability 参考，不照搬成另一个后台管理系统。

一个切片未通，优先修该切片，不靠增加抽象层、扩展宿主数量、复制 MCP tool 或新增术语解释失败。产品目标只维护本主设计；Resolve 专项文档是 subordinate implementation reference，不建立第二份产品 authority。

参考：[Blackmagic Support](https://www.blackmagicdesign.com/cn/support/)、[Resolve Edit](https://www.blackmagicdesign.com/products/davinciresolve/edit)、[Resolve Cut](https://www.blackmagicdesign.com/products/davinciresolve/cut)、[Resolve Media](https://www.blackmagicdesign.com/products/davinciresolve/media)、[community Resolve MCP control panel](https://github.com/samuelgursky/davinci-resolve-mcp)、[community Resolve CLI/MCP field guide](https://github.com/dmmdea/davinci-resolve-cli)。

