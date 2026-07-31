# Flovart

Flovart 是本地优先的 Workflow + Table + Agent AI 创作工具。本文固定工作区、Provider、模型路由和制作运行时相关的领域词，避免后续把不同概念混在一起。

## 产品入口

**App Home**：
用户进入产品后的作品发现与项目续作入口，用于浏览可 Remix 作品、继续本地项目并进入 Workflow、Table 或 Agent；它不是独立创作工作区。
避免混用：Public Landing、Workflow Workspace、UGC 独立工作区。

**Community Gallery**：
App Home 中公开展示 Published Work 的作品发现界面；作品媒体是浏览主体，Remix Bundle 只作为可选复刻来源。
避免混用：Workflow Template Gallery、Local Work 列表、独立 UGC Workspace。

**Local Work**：
用户保存在当前 Browser Workspace 或 Local Data Service 中的最终图片或视频作品，默认只对当前用户本地可见，未经明确发布不会进入在线社区。
避免混用：Published Work、临时预览、Provider 生成结果。

**Published Work**：
创作者明确发布到在线社区的最终图片或视频作品，可选择绑定一个由 Skill 与参考 Workflow 组成的 Remix Bundle；最终媒体始终是首页展示主体。
避免混用：Workflow Template、PromptPack、本地项目、生成历史记录。

**Remix Bundle**：
随 Published Work 选择性发布的复刻单元，由一个精确、不可变的 Community Production Skill 版本和一份 Reference Workflow Snapshot 组成；复刻会把 Skill 加入接收者的 Skill 库，并以参考 Workflow 创建新项目。
避免混用：单独 Skill Package、Workflow Template、完整项目备份。

**Reference Workflow Snapshot**：
Remix Bundle 中演示 Skill 用法的不可变、可移植 Workflow 投影，保留节点、连线、提示词、产品模型身份和生成参数，但不包含秘密、Provider Route、本地路径、运行历史、Agent 会话或私有素材；接收者使用自己的模型映射运行。
避免混用：完整 Workflow Project、项目备份、Provider 请求记录。

**Work Publication**：
已登录创作者把选定 Local Work 明确转为 Published Work 的行为；未执行发布的本地作品不会被社区读取。
避免混用：保存项目、生成完成、分享到本地素材库。

## 创作工作区

**Workflow Workspace**：
面向生成编排的节点工作区，用于组织提示词、参考素材、模型配置、生成依赖、任务状态和结果节点。
避免混用：Table Workspace、Agent Workspace、旧 Canvas Workspace、旧 Art Workspace。

**上下文媒体条（Context Media Bar）**：
Workflow Workspace 中选中媒体节点后出现的轻量操作条，现有代码入口为 `WorkflowNodeToolbar`，也就是讨论中所说的 ElementBar；它总共只常驻 5–7 个高频动作，其中按图片或视频切换 3–5 个类型专属动作，长尾能力进入“更多”、工具面板或节点内参数区。
避免混用：完整工具架、PromptBar、节点参数面板、右键菜单、工具箱模板。

**媒体代理（Media Proxy）**：
Workflow 全景或普通浏览状态中替代原始媒体的轻量视觉资源；图片使用与屏幕投影尺寸匹配的缩略图，视频使用首帧 Poster，不承担播放、编辑、Provider 输入或下载语义。
避免混用：原始媒体、活动媒体、生成结果记录。

**活动媒体（Active Media）**：
当前唯一升级为完整交互组件的媒体节点；视频只有成为活动媒体后才挂载真实播放器，单纯选中节点只负责显示 PromptBar 与上下文媒体条。
避免混用：选中节点、悬停节点、视口内节点、故事板预览。

**Table Workspace**：
面向节点式媒体处理的工作区，用有向节点图组织输入媒体、抠图、深度、结构提取、风格化、服装修改、参考准备和输出；它不承担 Provider 生成编排或 Agent 对话。
避免混用：Workflow Workspace、Workflow Graph、Agent Workspace、旧 Art Workspace。

**Table Session**：
一张 Table Processing Graph 及其输入媒体、画布视口、预览、任务状态和候选输出组成的媒体处理上下文。
避免混用：Workflow Project、Agent Session、单次工具调用。

**Table Processing Graph**：
Table Session 中由输入、处理和输出节点及其类型化有向连线组成的媒体计算图；它表达媒体变换关系，但不表达 Workflow 的生成依赖。
避免混用：Workflow Graph、Table Process Stack、生成任务编排。

**Agent Workspace**：
把 Codex 线程、任务状态、项目上下文、工具执行和产物以可摆放面板组织起来的空间任务界面；画布只负责空间布局和导航，不承担 Workflow 数据流。
避免混用：Workflow Workspace、Table Workspace、右侧聊天抽屉、通用无限画布。

**Agent Panel**：
Agent Workspace 中的第一等布局对象，可承载 Codex 对话、项目 Brief、运行状态、待确认事项或产物，并直接显示 idle、running、waiting、done 或 error 状态。
避免混用：Workflow Node、Table Session、浏览器弹窗。

**Preprocessing Artifact**：
由 Table 从源媒体派生的可复用 Artifact，保留来源关系，可进入素材库并作为 Workflow 的参考输入。
避免混用：临时预览、Workflow 生成结果、原始 Provider URL。

## 产品分发

**Desktop Edition**：
面向个人设计师的免登录、本地优先 BYOK 图形化产品；V1 正式支持 Windows 10/11 x64，通过 EXE 安装器交付，用户无需理解或安装 Git、Node.js、Go 与 Docker。
避免混用：Web 开发服务器、Agent Toolkit、SaaS Deployment。

**Agent Toolkit**：
面向本地 Coding Agent 用户的终端产品，包含 TUI、CLI 与宿主适配，并连接 Flovart 的统一 Runtime 与命令契约；普通用户通过 npm Bootstrapper 获取版本化 Runtime Release Bundle，不从 Git 克隆源码。正式安装后的 `flovart start` 统一启动本地 Runtime、WebUI 和用户选择的 Coding Agent。
避免混用：Desktop Edition、Production Skill Package、SaaS Deployment。

**Local Workbench Session**：
由一次 `flovart start` 管理的本地运行会话，统一持有 Runtime、WebUI、TUI 和所选 Coding Agent 的进程状态、端口与关闭顺序；它可以附着到 Local Runtime Registry 中兼容的 Desktop Runtime，否则启动 Agent Toolkit 自有 Runtime。各组件仍保留只用于排障的独立启动命令。
避免混用：ProductionSession、Source Development Mode、SaaS Deployment、常驻系统服务。

**Agent Bootstrapper**：
通过 `npx flovart` 启动的轻量 npm 包，负责版本解析、下载校验、安装、升级和启动 Agent Toolkit；它不携带完整应用源码，也不要求普通用户安装 Git、Go 或 Docker。
避免混用：Runtime Release Bundle、源码仓库、Desktop Edition 安装器。

**User CLI Launcher**：
由 Agent Bootstrapper 安装到当前用户目录并加入用户级 PATH 的稳定 `flovart` 命令入口，不依赖 `npm install -g`；它解析当前已启用的 Agent Toolkit 版本并启动对应 CLI。
避免混用：临时 `npx` 进程、npm 全局包、Desktop EXE、Runtime Release Bundle。

**Runtime Release Bundle**：
由官方 Release 发布、带精确版本与完整性清单的 Agent Toolkit 运行包，包含已构建 WebUI、本地 Runtime、固定 Agent Node Runtime 及所需宿主组件，安装到用户级版本目录并由 Agent Bootstrapper 管理。
避免混用：Git 工作树、npm Bootstrapper、SaaS 镜像、NSIS Desktop 安装器。

**Agent Node Runtime**：
随 Desktop Edition 与 Runtime Release Bundle 按平台捆绑、由 Flovart 校验并专供内置 PI Agent 使用的固定 Node.js 运行时；正式安装不读取系统 `node`，版本与 PI 依赖随 Flovart Release 一起升级。
避免混用：用户系统 Node.js、浏览器 JavaScript Runtime、Rust Desktop Runtime、Provider Worker。

**Local Runtime Registry**：
Desktop Edition 与 Agent Toolkit 在当前操作系统用户范围内共享的 Runtime 发现记录，声明进程、协议版本、发行版本、端口和会话认证信息；Agent Toolkit 只复用身份可信且协议兼容的现有 Runtime。
避免混用：公开服务发现、固定 localhost 端口、SaaS 服务注册、项目数据库。

**Local Data Service**：
安装 Desktop Edition 或 Agent Toolkit 后在当前用户范围内运行的本地数据权威，为 EXE、CLI、受信 Edge Extension 和已配对 Official WebUI 提供画布、Workflow、Artifact、设置与 Provider 执行能力；调用方不直接读取同一文件，也不能取得原始 Provider Secret。
避免混用：SaaS Backend、公开 localhost API、浏览器 localStorage、文件同步工具。

**Browser Workspace**：
用户首次仅访问 Official WebUI 且没有 Local Data Service 时，在该网站 origin 中创建的浏览器本地工作区；Workflow、Agent 布局、生成历史、素材索引、模型选择与模型缓存统一通过 `localforage` 写入 IndexedDB，媒体 Blob 使用独立的 `localforage` store，避免把大二进制塞入项目 JSON。它允许独立创作，但不会自动读取 EXE、Edge 或其他域名的存储。
避免混用：Local Data Service 中的正式本地工作区、云同步空间、浏览器缓存。

**Browser UI Preference**：
主题、语言、面板开关或宽度等极小且首屏需要同步读取的浏览器设置；它们可以使用 `localStorage`，不得保存 Workflow、生成记录、素材、图片、视频、Base64、大 JSON、Provider Secret 或登录 Token。
避免混用：Browser Workspace、Browser Secret Vault、Hub Session Token。

**Hub Session Token**：
Official WebUI 登录 Go Hub 后仅在当前标签会话使用的短期 JWT；当前实现保存在 `sessionStorage`，长期方案应由 Go Hub 使用 Secure、HttpOnly、SameSite Cookie，不写入 `localforage` 或 `localStorage`。
避免混用：Provider Secret、Runtime Token、SaaS 组织 API Key。

**Browser Secret Vault**：
Official WebUI 在纯网页模式下使用的 Provider Secret 存储边界；需要持久保存的密文通过 `localforage` 写入 IndexedDB，也可以由用户选择只在当前会话使用。静态加密不能抵御同源脚本在页面运行期间使用密钥，安全性不等同于操作系统凭据库。
避免混用：Windows Credential Manager、Edge Extension storage、项目文件、SaaS 组织密钥。

**Workspace Merge**：
用户安装 Local Data Service 后显式发起的一次浏览器工作区合并，把 Browser Workspace 的项目数据导入正式本地工作区，并在确认成功后把选择保留的 Provider Secret 迁入操作系统凭据库；冲突与删除必须由用户确认。
避免混用：自动云同步、静默覆盖、浏览器 origin 共享、旧数据兼容兜底。

**Source Development Mode**：
贡献者在已经显式克隆的 Flovart 仓库中使用的开发入口，可运行源码、安装 Go 与 Node 依赖并连接开发服务；它不属于 `npx flovart` 的普通安装流程。
避免混用：Agent Toolkit 正式安装、Desktop Edition、SaaS Deployment。

**SaaS Deployment**：
面向多用户托管服务的生产部署形态，由版本化服务镜像、生产配置和运维入口组成。
避免混用：本地开发 Compose、Windows 启动脚本、Desktop Edition。

**Edge Extension**：
通过 Microsoft Edge Add-ons 分发的 Desktop Edition 薄伴侣，只采集并转交用户明确选择的网页内容，并在用户配对后为 Official WebUI 提供受限本地桥接；它不保存 Provider Secret，也不执行生成任务。
避免混用：Provider Plugin、Production Skill、Desktop Edition、任意网页监控器。

**Desktop Bridge Host**：
由 Desktop Edition 安装并注册给 Edge Native Messaging 的最小本机宿主，只接受受信扩展和兼容协议；收到用户主动发起的导入或已授权 WebUI 桥接动作时，它负责启动或激活 Desktop Runtime 并投递类型化请求，不保存 Provider Secret，也不执行生成。
避免混用：Edge Extension、Desktop Runtime、Provider Adapter、公开 HTTP 服务。

**Browser Import Action**：
用户在 Edge 中显式触发的一次内容转交；V1 仅包括右键发送单张图片、发送选中文本和截取当前可见区域，每次只读取完成该动作所需的当前页面内容。
避免混用：整页图片采集、后台网页监控、浏览历史同步、Provider 请求。

**Trusted Web Bridge**：
用户在 Edge 中明确批准后，为 `https://avabbbb.github.io/Flovart/` 建立的可撤销本地能力通道；Official WebUI 可以通过类型化接口访问获批工作区数据并请求 Runtime 执行，但不能读取原始 Provider Secret，也不能把权限扩展给其他网页 origin。
避免混用：任意网页 External Messaging、CORS 白名单、公开 localhost API、账号登录。

**Local Terms Acceptance**：
用户在首次保存 Provider Secret 或首次发起可能计费的 Provider 请求前，对特定协议版本作出的本地明确同意记录。
避免混用：账号注册、Provider 授权、System Gate、应用安装。

## 领域词

**Provider**：
用户保存的外部 AI 服务账号，用来提供文本、图片、视频或 Agent 等生成能力。
避免混用：Vendor、Channel、API Config。

**Route Mapping Target**：
需要解析到 Provider Route 的稳定执行意图；媒体目标由 Product Model 与 Generation Mode 共同标识，文本目标由 Runtime Capability 标识，例如提示词增强、脚本拆解和 Agent 文本生成。
避免混用：Provider Route、Provider 默认模型、PromptBar 临时选择。

**Route Mapping**：
用户在统一“模型映射”中心把 Route Mapping Target 绑定到按提交优先级排列的 Provider Route，是 Workflow、Table 与 Agent 选择执行线路的唯一用户配置来源。
避免混用：Model Preference、API Key 健康状态、Provider 默认模型、Run Route Plan。

**Standard Model**：
Provider 托管的单模型生成端点，请求字段和结果格式由该 Provider 自己定义。
避免混用：OpenAI Compatible Model、Workflow App。

**AI App**：
Provider 托管的类工作流应用，运行前需要把用户输入映射到可编辑节点或字段。
避免混用：Standard Model、Plain Model。

**Product Model**：
Flovart 面向用户稳定展示的一种生成模型身份，使用可由官方依据确认的原始模型名称（例如 GPT Image 2、Veo 3.1），可通过不同 Provider Route 执行，并保持统一的产品名称与能力预期。
避免混用：Provider 包装别名、Provider Model、Standard Model Endpoint、上游模型 ID。

**Generation Mode**：
一次生成对输入与输出关系的明确分类，例如文生图、图生图、文生视频、图生视频、首尾帧或多模态参考。
避免混用：Product Model、Workflow Node Type、Provider Route。

**Provider Route**：
Provider 为某个 Generation Mode 提供的可执行模型线路，具有自己的端点、输入字段、能力限制、稳定性和价格。
避免混用：Product Model、Provider、Route Mapping。

**Provider Route Label**：
设置与线路选择界面展示的渠道名称，由 Provider、Provider 包装别名和线路等级组成，例如 `RunningHub · 全能图片 G-2 · 低价渠道`；不得替代 PromptBar 中的 Product Model 名称。
避免混用：Product Model 名称、Provider Route ID、营销显示名。

**Route Binding**：
Route Mapping 中一条经过用户确认的目标到线路关系；目标类型为 `product-mode` 或 `runtime-capability`，并可绑定主线路与有序备用线路。
避免混用：单一模型别名、Provider 默认模型、自动生效的线路建议。

**Route Selection Policy**：
用户为同一 Route Mapping Target 的候选 Provider Route 设定的提交前优先顺序；首次建立 RunningHub 映射时低价渠道默认排在官方稳定线路之前，但必须显式展示其稳定性风险与 Route Price Quote。主线路在提交前不可用时，系统可以预选下一条可用线路，但必须明确展示线路变更并由用户确认；ProviderAttempt 开始后不自动切换线路。
避免混用：自动重试、提交后 Failover、Route Mapping。

**Route Price Quote**：
Provider 在正式提交前根据最终 Provider Request 返回的费用预估；它用于展示和预算判断，获取失败时状态为未知，不得伪装为零价、缓存价或已确认价格。
避免混用：实际扣费、Provider 余额、Route 固定价格、Run Budget。

**Generation Request**：
一次与 Provider 无关的生成意图，包含 Product Model、Generation Mode、提示词、规范化参数和媒体角色。
避免混用：Provider Request、Workflow Node、原始 HTTP Body。

**Route Capability Schema**：
Provider Route 对可用 Generation Mode、参数取值、媒体角色、数量限制和序列化类型的已验证契约。
避免混用：Product Model 能力声明、用户 JSON 模板、Provider 文档链接。

**Provider Adapter**：
把 Generation Request 按 Route Capability Schema 转换为 Provider Request，并统一解释任务生命周期与结果。
避免混用：Provider Route、Provider Worker、产品模型映射表。

**Route Preflight**：
正式提交前用最终 Route Capability Schema 校验 Generation Request 的参数、媒体角色和数量；发现不支持的已选值时返回具体冲突并阻止提交，不得静默删除、替换或降级用户意图。
避免混用：Prompt 内容审核、Provider 请求失败、自动参数修复。

**Discovered Route**：
从 Provider 模型列表或用户输入识别到、但尚未具有已验证 Route Capability Schema 的 Provider Route；它可以被展示但不能执行。
避免混用：Verified Route、已配置模型、可执行线路。

**Route Catalog**：
Flovart 随版本发布的 Verified Route 集合，每条线路都带有可执行的 Route Capability Schema 和官方来源依据。
避免混用：Provider 实时模型列表、用户收藏、Product Model Catalog。

**Local Verified Route**：
用户在 Flovart 已支持的 Provider Adapter Family 内，通过 BYOK 映射向导生成版本化 Route Capability Schema、完成 Route Contract Test 并确认后，仅在本机可执行的 Provider Route；未知协议仍需新增受审 Provider Adapter。
避免混用：Discovered Route、官方 Route Catalog 条目、任意 HTTP 映射、用户脚本 Adapter。

**Run Route Plan**：
Desktop Runtime 在 ProductionRun 开始前根据 Route Mapping、Capability Requirement、Validated Profile、报价和可用性生成并由用户确认的不可变线路计划，逐项锁定本次运行各能力或阶段使用的 Provider Route。
避免混用：Route Binding、Route Selection Policy、提交后自动 Failover、Production Skill 模型配置。

**Route Contract Test**：
针对一条 Verified Route，用代表性 Generation Request 验证 Adapter 生成的 endpoint、字段名、类型、默认值、媒体角色和数量限制均符合 Route Capability Schema 的无费用测试。
避免混用：Provider Smoke Test、UI 单元测试、真实任务成功。

**Provider Smoke Test**：
在用户明确批准费用后向真实 Provider 提交的最小端到端生成，用于验证认证、上传、提交、查询和结果解析；第一阶段按 Generation Mode 选择一条最低成本代表 Route，而不是默认实测所有线路。
避免混用：Route Contract Test、Provider 健康检查、模型质量评测。

## 制作编排

**Production Skill**：
把用户创作意图转成 ProductionSpec 的风格化导演知识包，不持有 Provider 凭据，也不直接执行生成任务。
避免混用：Provider Plugin、Workflow Runtime、Model Adapter。

**Flovart Agent**：
绑定到一个 ProductionSession 的有状态制作决策主体，结合创作 Brief、可选 Primary Skill Binding、ProductionSpec 与受限制作能力形成连续工作上下文；每个 ProductionSession 同时只有一个活跃 Flovart Agent。
避免混用：Production Skill、Coding Agent、Production Authority、Provider Worker。

**Agent Kernel**：
内置 Flovart Agent 的非用户可见 TypeScript 执行内核，基于固定版本的 `@earendil-works/pi-agent-core` 运行对话、工具循环、流式事件和 Specialist Agent；它通过 Runtime 提供的 `agent-text` 流与受限 Production Intent 调用工作，不直接读取 Provider Secret、文件系统或 Shell。
避免混用：Flovart Agent 产品身份、PI Coding Agent、Coding Agent Adapter、Desktop Runtime。

**Specialist Agent**：
由 Flovart Agent 针对一项专业判断临时委派的受限分析主体，只返回结构化证据与建议，不拥有 ProductionSpec 修订、Production Mandate 请求或 Provider 提交权。
避免混用：Flovart Agent、Coding Agent、Provider Worker、平级制作总监。

**Specialist Capability**：
平台拥有的类型化专业判断契约，限定 Specialist Agent 的任务语义、输入、结构化输出与最大权限；Production Skill 只能请求已注册能力并补充风格上下文。V1 注册 narrative-review、shot-plan-review、evidence-review 与 visual-continuity-review，预算、线路和格式可行性仍由 Runtime 确定性裁决。
避免混用：Runtime Capability、自由文本角色 Prompt、Production Skill 私有 Agent、Provider Capability。

**Specialist Report**：
Specialist Agent 针对一次委派返回的不可变结构化判断，包含结论、分级发现、证据、建议、可选 ProductionSpec 修订提案与用量摘要；它必须由 Flovart Agent 采纳后才能形成新的 Revision。
避免混用：聊天回复、ProductionSpec Revision、可直接执行的 Patch、Skill Eval。

**Production Skill Package**：
可由 Codex/OpenCode 读取并由 Flovart 验证、安装和评测的不可变 Skill 目录，包含精炼 SKILL.md、生产 Manifest 及按需资源。
避免混用：Git 仓库、Hub 页面、任意脚本压缩包。

**Flovart Skill Manifest**：
Production Skill Package 根目录的 `flovart.skill.yaml`，声明包身份与版本、兼容性、Interaction Commands、Runtime Capabilities、Permissions、Gates、Extension Schema 和 Eval 入口。
避免混用：SKILL.md frontmatter、Provider 配置、ProductionSpec 实例。

**Deterministic Skill Script**：
Package 中具有已声明输入输出、无网络、无秘密且在受限 Sandbox 内执行的可复现转换脚本，不能直接提交 Provider Job 或调用任意外部二进制。
避免混用：Provider Worker、Runtime Capability、Agent Shell 命令。

**Flovart Skill Creator**：
官方 Meta Skill 与 CLI 工作流，用具体示例引导创建或迁移 Production Skill，并依次完成 scaffold、validate、dry-run、eval、pack 和 publish。
避免混用：Hub 审核员、通用 Codex skill-creator、在线代码生成器。

**Skill Snapshot**：
Local Draft 在参与 ProductionSpec 或 ProductionRun 前生成的不可变 Package 内容快照，以精确版本和内容哈希标识。
避免混用：可变作者工作目录、Git Commit、Hub Release 标签。

**Skill Lock Entry**：
`flovart.lock` 中按 Skill ID、精确版本和 Package Hash 记录的已解析依赖，可同时保留同一 Skill 的多个历史版本。
避免混用：SemVer 范围、最新版本偏好、ProductionSpec Extension。

**Skill Revocation Severity**：
Hub 针对精确 Skill 版本与 Hash 发布的 advisory、block_new 或 critical 等级，分别用于警告、阻止新运行或阻止后续 Provider 提交。
避免混用：远程删除、本地卸载、普通升级通知。

**ProductionSession**：
一部作品从创作 Brief、Agent 对话、ProductionSpec 修订到多次 ProductionRun 的上下文边界；一个 Flovart Project 可以包含多个彼此隔离的 ProductionSession。每个 ProductionSession 保留一条可恢复的 Flovart Agent 主对话，探索分支在提升为主分支前不能推进正式计划或请求执行授权。
避免混用：Flovart Project、Agent Session、ProductionRun。

**Primary Skill Binding**：
ProductionSession 对至多一个精确 Production Skill 版本或 Skill Snapshot 的可选创意规划绑定；没有绑定时 Flovart Agent 使用 ProductionSpec Core 直接进行通用制作，且不创建虚构的通用 Skill。Agent 可以根据 Brief 推荐 Skill，但只有用户明确确认后才能建立或更换绑定，且系统不得静默切换；更换绑定必须显式重新规划，产生新的 ProductionSpec Revision 并使旧 Production Mandate 失效，已提交的 ProductionRun 不被原地改写。
避免混用：Flovart Skill、通用素材包、Validated Profile、运行时临时读取多个 Production Skill。

**Production Session Workspace**：
Production Mode 下为单个 ProductionSession 创建的隔离文件工作区，只向 Agent 暴露只读权威上下文、可写 scratch/exports 和非秘密绑定信息。
避免混用：Flovart 源码仓库、Runtime 数据目录、Artifact Store 内部目录。

**Skill Authoring Session**：
用户通过 `skill dev` 显式选择 Production Skill 仓库后创建的开发会话，允许 Agent 在宿主 Sandbox 与 Agent Tool Approval 约束下修改 Skill 源码和测试。
避免混用：ProductionSession、公共 Hub 编辑器、默认磁盘权限。

**ProductionSpec**：
Flovart Agent 输出的结构化制作计划，描述叙事、镜头、素材依赖、审批门、能力需求和交付规格；可选 Production Skill 只能在共同 Core 之上增加已声明的制作方法。
避免混用：Workflow Project、Table Workspace State、Provider Request。

**ProductionSpec Core**：
所有通用制作与 Production Skill 共用的制作计划字段，统一表达作品规格、叙事、镜头、音频、审批门和交付要求。
避免混用：导演风格模板、Skill 私有 DSL、Workflow 节点结构。

**ProductionSpec Extension**：
位于 `extensions.<skill-id>` 下并由 Production Skill 自带 Schema 声明的风格专属规划字段，不得增加私有执行阶段。
避免混用：未知根字段、Runtime Capability、Provider 参数。

**Runtime Capability**：
由 Flovart Runtime 提供并由稳定契约标识的原子制作能力，例如图片生成、视频生成、语音、音乐、渲染和验证。
避免混用：CLI Command、Provider Model、Production Skill。

**Atomic Runtime Command**：
由 Desktop Runtime 执行的最小可恢复操作，只表达一个明确状态转换或外部副作用，并具有显式目标、封闭类型输入、幂等键、持久任务句柄和可查询结果。
避免混用：Production Intent Command、Production Skill 工作流、隐藏全局配置驱动的复合操作。

**Production Intent Command**：
面向 Coding Agent、CLI 或 WebUI 的便捷目标命令，例如 `workflow.node.run`、`generate.image`；Runtime 将其展开为一个 ProductionRun 内的多个 Atomic Runtime Command，本身不是重试、计费或恢复的原子边界。
避免混用：Atomic Runtime Command、Interaction Command、ProductionSpec。

**Interaction Command**：
TUI 中以斜杠触发的类型化交互入口，解析后只能调用规范 CLI Command、创建 Agent Intent 或请求 Runtime Capability，本身不是新的执行后端。
避免混用：任意 Shell 别名、自由文本 Prompt、Runtime API。

**Command Dispatch**：
Interaction Command 的类型化去向，只允许 `runtime_command`、`tui_action`、`agent_intent` 或 `capability_request`；Production Skill 只能声明后两种。
避免混用：Shell 命令模板、HTTP URL、脚本入口。

**Platform Command Namespace**：
由 Flovart 保留的 `/flovart <action>` 稳定命名空间，用于状态、计划、执行、审批、预算、产物和 Skill 管理等平台能力。
避免混用：Production Skill 命令、CLI 原子命令名称、本地快捷别名。

**Skill Command Namespace**：
Production Skill 通过 Manifest 声明的 `/flovart <skill-slug> <action>` 受控命名空间，不得占用平台命令或注册任意全局斜杠命令。
避免混用：Skill ID、Runtime Capability、用户本地别名。

**Local Command Alias**：
用户在本机显式启用并通过冲突检查后生成的 Production Skill 短入口，例如 `/vox`；发布者不能默认启用或据此获得全局命名权。
避免混用：公共 Skill 名称、平台保留命令、Hub 分发元数据。

**Terminal Command Center**：
使用独立 TypeScript/Node + Ink package 实现的本地 TUI，负责命令发现、Agent 交互、ProductionRun 观察和审批操作，但不持有生产状态真相。
避免混用：Desktop Runtime、WebUI、Go Enterprise Backend。

**Coding Agent Adapter**：
Terminal Command Center 用来检测、启动、恢复和取消外部 Coding Agent 会话的托管适配器；复用用户已有 CLI 登录，不提供内置模型服务。V1 的正式 Managed Agent 只有 Codex。
避免混用：Connected Agent、Provider Adapter、MCP Server、Desktop Runtime。

**Managed Agent**：
具有已实现 Coding Agent Adapter、可由 `flovart start` 启动，并由 TUI 统一执行线程创建、恢复、取消、状态观察和退出回收的 Coding Agent；V1 指 Codex。
避免混用：Connected Agent、AI Provider、Flovart 内置模型。

**Connected Agent**：
通过 Flovart MCP Server、CLI 或 Production Skill 调用 Runtime Capability，但其安装、登录、进程和会话生命周期不由 Flovart 托管的外部 Coding Agent；V1 可包含 Claude Code、OpenCode、Cursor 等经过连接测试的宿主。
避免混用：Managed Agent、Coding Agent Adapter、仅出现在配置列表中的未验证宿主。

**First-Class Agent Adapter**：
能够通过宿主官方结构化协议提供会话创建与恢复、事件流、取消、审批和健康检查的 Coding Agent Adapter；V1 范围为 Codex 与 OpenCode。
避免混用：PTY 文本抓取、独立终端兼容模式、模型 Provider。

**Codex App Server Transport**：
Codex Adapter 使用本机 `codex app-server` 的 stdio JSON-RPC/JSONL 协议实现深度集成，并以 `codex exec --json` 作为显式降级路径。
避免混用：Codex TUI 输出、MCP Server、Flovart Desktop Runtime API。

**OpenCode SDK Transport**：
OpenCode Adapter 通过官方 TypeScript SDK 连接绑定在 `127.0.0.1` 随机端口、使用随机 Basic Auth 密码的本地 Server，并订阅 SSE 事件。
避免混用：OpenCode TUI、公共 HTTP 服务、Provider API。

**Agent Protocol Handshake**：
Coding Agent Adapter 启动时对宿主版本、健康状态和必需协议能力进行结构化校验，不满足契约时显式降级或拒绝启动。
避免混用：仅检查可执行文件存在、解析帮助文本、自动升级宿主。

**Agent Tool Approval**：
由 Codex 或 OpenCode 宿主请求并裁决的 Shell、文件、网络或 Agent 工具权限，只影响当前 Agent Turn 的执行能力。
避免混用：Production Gate、Run Budget、Production Skill 权限。

**Production Gate Approval**：
由 Desktop Runtime 记录和执行的预算、安全、素材或审片决定，只影响 ProductionRun，不授予 Agent 额外系统权限。
避免混用：Agent Tool Approval、Provider 登录弹窗、普通确认消息。

**Agent Session Binding**：
ProductionSession 与一个外部 Coding Agent 会话之间可恢复的本地关联，保存宿主类型和非秘密会话标识，不持有 ProductionRun 生命周期。
避免混用：ProductionRun、TUI 进程、Agent API Key。

**Agent Session Store**：
由内置 PI Agent 独占写入的本地 SQLite 会话库，保存主对话、探索分支、消息、工具轨迹和 Specialist Report，并只以稳定 ID 引用 Desktop Runtime 中的权威制作对象；会话库不可决定规格、授权、费用、运行或产物状态。
避免混用：Desktop Runtime SQLite、浏览器 Agent 布局存储、外部 Coding Agent 线程、ProductionSession 本身。

**Agent Handoff Snapshot**：
切换 Coding Agent 宿主时由 Desktop Runtime 根据权威状态生成的不可变上下文快照，包含作品 Brief、Skill 版本、当前 Spec、已确认决策、Run 摘要、待审批项、Artifact 引用和预算状态。
避免混用：原始对话导出、隐藏推理、Agent 自行撰写的总结。

**Active Agent Binding**：
一个 ProductionSession 当前唯一可接收新交互的 Agent Session Binding；旧 Binding 归档但不删除，并可通过新的 Handoff 恢复为活动状态。
避免混用：并行 ProductionRun、多 Agent 协作、已删除会话。

**Desktop Runtime**：
运行在用户本机 Tauri/Rust 进程中的制作权威，持久化 ProductionRun、预算、审批、事件、Artifact 和秘密元数据，并协调本地 Worker。
避免混用：云端 Hub、Go Enterprise Backend、WebUI。

**Production Authority**：
唯一有权接受并持久化 ProductionRun 状态转换、审批、预算占用、ProviderAttempt 和 Artifact 来源关系的运行边界；V1 的 Production Authority 是用户本机的 Desktop Runtime。
避免混用：Skill Hub、Coding Agent、CLI、WebUI。

**Skill Hub**：
分发 Production Skill Package 的云端目录，保存版本、内容哈希、许可证、评测、认证和撤销信息；不持有用户 Provider 凭据，也不拥有或执行 ProductionRun。
避免混用：Desktop Runtime、Provider Worker、云端成片队列。

**Runtime Control API**：
Desktop Runtime 绑定在 `127.0.0.1` 随机端口的版本化本地命令接口，使用每次启动轮换的 Bearer Token、幂等键和协议握手服务 CLI/TUI。
避免混用：云端 REST API、Tauri WebView IPC、Provider API。

**Runtime Discovery Record**：
由 Desktop Runtime 写入当前操作系统用户受保护目录的临时发现记录，包含 PID、端口、协议版本和本次启动的连接凭据，并在退出或失效检测后清理。
避免混用：长期 API Key、项目配置、公共端口注册。

**Runtime Event Stream**：
从持久化 Runtime Event Ledger 投射的可恢复 SSE 流，事件具有单调 ID，客户端可通过 `Last-Event-ID` 在重连后续传。
避免混用：子进程 stdout、Agent Token Stream、非持久通知。

**Provider Worker IPC**：
Desktop Runtime 与 TypeScript Provider Worker 之间的私有结构化 stdio 通道，Runtime 仅在请求执行时注入所需秘密，Worker 不返回或记录原始凭据。
避免混用：Runtime Control API、浏览器 Provider 请求、Shell 管道脚本。

**Runtime-Only Mode**：
Desktop Runtime 不显示主窗口但继续提供本地 API、队列、Worker 和恢复能力的后台运行模式。
避免混用：开机自启、隐藏窗口、CLI 进程。

**Action Required**：
ProductionRun 因 API Key 设置、System Gate 或人工审片需要用户介入时返回的可恢复状态，包含打开对应界面的 deep link。
避免混用：运行失败、普通通知、Agent 自动批准。

**Provider Worker**：
由 Desktop Runtime 调度、使用 TypeScript Provider Adapter 执行具体模型请求并回报状态与结果的本地执行器。
避免混用：Production Skill、Desktop Runtime、Provider 本身。

**Capability Requirement**：
ProductionSpec 对 Runtime Capability 及其必需特性的声明，只表达输入、输出和质量约束，不指定 Provider 或模型。
避免混用：Route Mapping、Provider Request、Validated Profile。

**Validated Profile**：
某个 Production Skill 版本通过样片评测验证过的模型组合及其分数，用于优先解析而不是强制绑定。
避免混用：Route Mapping、必需模型、Provider 配置。

**Compatible Route**：
满足 Capability Requirement、但尚未由当前 Production Skill 版本完成样片验证的模型解析结果。
避免混用：Validated Profile、默认模型、自动成功保证。

**ProductionRun**：
一次 ProductionSpec 的实际执行实例，独立记录阶段、尝试、审批、产物、费用和状态事件。
避免混用：Agent Thread、ProductionSession、Provider Job。

**StageRun**：
ProductionRun 中一个制作阶段的执行记录，独立维护依赖、阻塞原因、重试和产物；状态为 pending、ready、running、blocked 或终态。
避免混用：ProductionSpec Stage、ProviderAttempt、Workflow Node。

**ProviderAttempt**：
StageRun 对 Provider 的一次不可变提交尝试，记录从 created、submitting、submitted、polling 到结果或 submission_unknown 的完整生命周期。
避免混用：机械重试计数、StageRun、Provider Model。

**Runtime Event Ledger**：
Desktop Runtime 在状态变化事务中追加的不可变事件序列，为 Runtime Event Stream、审计和恢复提供依据，但不作为 V1 唯一查询模型。
避免混用：Usage Ledger、Agent Event、应用日志。

**State Projection**：
与 Runtime Event Ledger 在同一 SQLite 事务更新的当前状态表，用于快速查询 ProductionRun、StageRun 和 ProviderAttempt。
避免混用：纯 Event Sourcing、前端缓存、SSE 客户端状态。

**ProductionSpec Revision**：
ProductionSpec 的不可变版本；任何镜头、提示词、素材依赖或阶段结构调整都创建新版本，不覆盖已批准版本。
避免混用：运行时 Patch、Provider Retry、工作区撤销历史。

**Production Mandate**：
用户对一次制作执行边界的不可变授权记录，精确绑定获准使用的 ProductionSpec Revision、Run Route Plan、Run Budget、Review Policy、输入范围与审批门；任一绑定内容改变都会使旧授权失效。
避免混用：聊天同意、ProductionRun、Run Budget、ProductionSpec。

**Production Plan Card**：
Flovart Agent 面向用户展示的单一“制作方案”确认面，以人话汇总目标产物、可选 Production Skill、预计费用、关键审片点与执行范围，并允许按需展开底层规格和线路；主动作“确认并开始”以一次幂等操作生成对应 Production Mandate 并启动 ProductionRun，仅保存草稿或预览 Workflow 均不授权执行。
避免混用：聊天中的“可以”、完整 ProductionSpec 编辑器、Production Mandate 本身。

**Production Plan Projection**：
Desktop Runtime 根据一个 ProductionSpec Revision 派生并展示在 Workflow Workspace 的制作计划视图；确认制作方案后自动生成或刷新该投影，Agent Workspace 与 Workflow Workspace 共享同一 Runtime 运行状态。用户或 Agent 的有效计划编辑先生成新的 Revision，再同步刷新投影和受影响的 StageRun。
避免混用：ProductionSpec 权威真相、可独立执行的第二份 Workflow 图、仅改变节点坐标的视口操作。

**Agent Intervention Event**：
ProductionRun 需要创意重规划、失败诊断、审片决定或额外输入时，由 Desktop Runtime 发出的 Agent 介入信号；普通 Provider 轮询和进度展示由 Runtime 与 TUI 持续承担。
避免混用：Runtime Event Stream 中的每条进度事件、Agent 持续轮询、Production Gate Approval。

**Replan Request**：
ProductionRun 因创意反馈或语义性失败而提出的重规划请求，说明需要修改的范围和应保留的已完成产物。
避免混用：机械重试、错误日志、用户聊天消息。

**System Gate**：
由 Flovart Runtime 强制执行且不能被 Production Skill 或 Review Policy 跳过的审批门，用于权限、预算、安全和运行可行性边界。
避免混用：Skill Gate、User Gate、Provider 弹窗。

**Skill Gate**：
Production Skill 为故事、视觉风格、关键帧或成片质量推荐的创作审批门，可以按用户选择的 Review Policy 执行或跳过。
避免混用：System Gate、强制安全检查、Skill 内部步骤。

**Specialist Review Gate**：
通过一个 Specialist Capability 生成 Specialist Report 的 Skill Gate，由 Production Skill 声明 required 或 recommended，并按 Review Policy 决定是否执行。
避免混用：System Gate、Specialist Agent 的临时委派、Runtime 确定性校验。

**User Gate**：
用户针对特定 ProductionRun 主动插入的审批门，用来约束品牌、人物、素材、配音或费用等个别节点。
避免混用：Skill Gate、聊天反馈、全局偏好。

**Review Policy**：
用户在 ProductionRun 开始前选择的审片策略，决定执行哪些 Skill Gate；支持 Guided、Balanced 和 Autonomous，且不影响 System Gate。
避免混用：权限策略、重试策略、Production Skill 默认值。

**Run Budget**：
用户在 ProductionRun 开始前批准的费用边界，包含硬上限、重试预留和超限处理策略。
避免混用：Provider 余额、价格预估、组织额度。

**Cost Reservation**：
Runtime 在提交可能计费的 Provider Job 前从 Run Budget 中暂时锁定的额度，用于阻止并发步骤共同突破硬上限。
避免混用：实际扣费、积分冻结、费用预估。

**Usage Ledger**：
ProductionRun 的不可变费用流水，记录预留、确认、估算、释放和退款及其价格来源。
避免混用：Provider 账单、当前余额、可编辑统计。

**Submission Unknown**：
Runtime 已尝试提交 Provider Job、但无法确认任务是否创建成功的状态；该状态保留费用预留并禁止自动重新提交。
避免混用：提交失败、Provider Running、普通超时重试。

**Artifact**：
Flovart 制作过程中产生或导入的不可变媒体、文本或交付物记录，由稳定 ID 和内容哈希标识。
避免混用：Provider URL、Workflow Node、Table Node、临时文件。

**Artifact Store**：
以内容哈希寻址并保存 Artifact Blob 与元数据的本地真相源，负责去重、物化、保留和垃圾回收。
避免混用：浏览器缓存、素材列表 UI、云端 Hub。

**Artifact Provenance**：
Artifact 与其 ProductionRun、ProductionSpec Revision、StageRun、Provider Job、模型、提示词哈希和输入 Artifact 之间的来源关系。
避免混用：生成历史文案、文件修改时间、工作区连线。

**Skill Eval**：
使用真实任务、基线和可验证证据衡量 Production Skill 触发、规划与交付质量的评测记录。
避免混用：示例项目、人工好评、单次成功运行。

**Local Skill Draft**：
仅保存在作者本机、尚未进入公共 Hub 的 Production Skill 工作版本，可以运行校验和评测但不能公开分发。
避免混用：Community Production Skill、已发布版本、本地安装副本。

**Community Production Skill**：
通过静态校验、零费用 Dry Run、许可证和基础评测后在公共 Hub 分发的不可变 Production Skill 版本。
避免混用：Local Skill Draft、Certified Production Skill、受信任脚本。

**Certified Production Skill**：
在 Community 门槛之上通过受控样片、人工审片和安全检查的不可变 Production Skill 版本；认证不跨版本继承。
避免混用：已上传 Skill、已安装 Skill、受信任脚本。

**Skill Revocation**：
Hub 针对存在安全、许可或重大质量问题的特定 Skill 版本发布的禁用声明，阻止其创建新的 ProductionRun。
避免混用：版本下架、用户卸载、普通更新提示。
