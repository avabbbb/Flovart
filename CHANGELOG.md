# Changelog

## Unreleased

- **Visual Production Runtime projections**：CLI、MCP 与 DSH service 继续围绕同一份 canonical operation contract；新增脱敏 `ProductionTask` inspect/resume 投影、跨投影 parity 证据与 TeleAgent/Creative Host 接入边界，未迁移 Browser Workflow authority。
- **Flovart Link 2.0 与 Studio 基础**：收敛 Host lifecycle、四态 Agent UX、一次性 Browser bootstrap、Workspace Lease、`flovart ensure`、WorkBuddy official-shape Connector、DSH `ctx.flovart`/RC8 profile 和 Photoshop/Premiere/After Effects/Resolve Studio 共享 Studio contract/package；Resolve 画布入口改为只读取显式或 launcher discovery 的动态 loopback URL。真实第三方客户端、登录态和创作宿主回写仍按 Support Matrix 标记为 External Gate/Experimental。
- **测试稳定性**：Windows Vitest 默认 worker 上限固定为 4，避免全量并发触发 fork/句柄争用；当前 172 个测试文件、1105 passed、1 skipped，关键套件连续 10/10 通过。
- **Release Candidate Hardening**：加入 Windows 发布产物 checksum、安装包内容校验、SPDX SBOM、tag-only provenance attestation、CI 全量门禁与关键套件 10x 循环；补齐迁移/持久化/Canvas stress、插件故障 containment、离线提示、脱敏诊断、支持矩阵和 release red-team 证据，并让 Skill projection 的 Node.js 最低版本由 docs contract 与 package engine 自动对齐；本机 test-signed N→N+1 更新及隔离项目保留已通过。真实 Provider、Codex 登录、生产 updater key、Authenticode、跨 schema/中断迁移与正式发布仍为外部门禁。
- **Updater 产物校验**：稳定 tag 发布路径现在在 draft-first 流程中强制收集 `latest.json` 与 `.sig` sidecar，并校验版本化 HTTPS URL、产物存在性及签名文本一致；本机 test-signed feed 已通过，生产签名和 Hosted 发布仍为外部门禁。
- **CLI 分发修复**：补齐 `flovart-cli` npm 包的运行时模块白名单，并增加包清单可达性回归，避免安装后的 CLI 缺少 `bootstrap-coordinator`、Crew 或 Web discovery 模块。
- **桌面生成兼容性**：修复 Tauri/WebView2 对 `data:` 图片结果的处理，生成结果不再因 CSP 禁止 `fetch(data:...)` 而停在 `Failed to fetch`；保留普通远程媒体 URL 的下载路径。
- **Release 依赖安全**：移除当前源码未使用的高风险生产依赖，更新同主版本的 `nanoid`、`react-router`、`protobufjs`、`fast-uri`、`ip-address`、`ws` 与构建工具链，并把官方 npm registry 的完整依赖审计加入 Hosted security gate。
- **CodeQL 告警收口**：将选题研究产物键改为 4096 字符上限的无正则字符扫描，并增加恶意超长幂等键回归；旧 `main` 的远端告警仍需在候选 SHA 上由 Hosted CodeQL 重跑确认。
- **First Run → First Safe Generation**：首启可先进入 Canvas；AI 服务采用“服务地址 + API Key”渐进配置并自动发现模型，PromptBar/Graph/`@` 引用贯通真实 Fake Provider HTTP，外部生成经过费用确认与不可伪造的人工授权，补齐限流、超时、重试、幂等和刷新恢复验收。
- **Agent Surface Simplification**：新增 Host Registry 与 PATH-only Host discovery，拆分 Agent Identity、IDE Host、Distribution Target、Runtime Surface 和 Director Runtime Binding；`init --target` 安装 Skill projection，内置 Agent 工具收敛为 `status`、`workflow.inspect`、`workflow.selection.get`、`workflow.apply`、`workflow.node.run`，WorkBuddy 暂不进入 Director Binding。
- **External Agent Golden Path**：补齐动态端口启动、Windows 安全 URL 启动、Browser Workflow bootstrap/recovery、Active Writer、Launcher 一次性 Writer 激活与 stale-page 等待、Host Picker 显式 Skill Projection prepare 与 Codex/Generic CLI Skill projection；真实 DSH RC8 profile/bundle 已完成本地 install/boot/隔离 Workspace tracer，Claude Code/OpenCode 外部 CLI tracer 已通过，打包 Managed Agent 已验证调用方项目根与 Host discovery，DSH CLI 结构化参数已改为 JSON，并移除 Dock 中伪造 Director Session 的自动绑定路径；另以本地无 Provider 的 `image.crop@1` fixture 验证真实 Browser `workflow.node.run` 成功闭环，并修复 granular `workflow.node.tool` CLI 的 typed flag 归一化；Codex 登录态与用户确认仍保留为 pending-test。
- **Browser 启动与端口隔离**：源码启动的 `37522/17373` 现在只作为首选端口；冲突时自动切换 loopback 端口，并支持 `--web-port=0 --agent-port=0` 隔离测试。`web.open` 在发现就绪 Agent 时自动使用一次性 bootstrap，同时保持返回值脱敏；Skill 不再把单独的 `npm run dev` 误导为 Agent 启动方式。真实 Chrome for Testing 已验证普通 origin 不绑定、bootstrap 后 `clients=1 / hasWorkflow=true`，测试不再调用 Windows 默认 Edge。
- **Workflow 输入解析**：新增统一的资源引用与 Graph 输入解析路径，已连接媒体不再依赖 PromptBar `@` 才能进入生成请求，并保留 Artifact 身份与现有显式引用筛选。
- **PromptBar 引用契约**：PromptBar 通过 provider-neutral `PromptIntent` 表达提示词与引用；Graph、`@`、Asset、Runtime Artifact 统一进入 Canonical Generation Input，Provider 角色/能力不匹配在请求前明确失败，产品模型策略移出 UI 组件。
- **Agent Canvas Contract（G3）**：稳定 Workflow surface 收敛为 `workflow.inspect`、`workflow.selection.get`、`workflow.apply` 与 `workflow.node.run`；选择读取脱敏且不改 revision，旧 granular commands 仅作为统一 operations 的兼容适配，Browser-bound Agent 不再隐式回落 Native。
- **Provider Extension Contract（G4）**：增加基于 Canonical Generation Input 的受限 User Script Provider mapping，支持声明式请求/响应/轮询/取消与 HTTPS/凭据边界；Graph reference 可进入自定义图片/视频线路，不支持时显式失败。
- **Workflow Node Plugin SDK（G5）**：在既有 Resource Contract 之上增加受限节点插件定义、快照 Context、结构化 `applyOps`、隔离 storage/events 与 install/update/enable/disable/uninstall 生命周期，内置 Markdown、Storyboard Card、Style Bible reference plugins；不开放 Provider、Runtime DB、React store 或凭据。
- **Canvas Platform Convergence 最终集成（G7）**：完成 Browser bootstrap、UI/CLI Workflow parity、真实节点/连线/Undo/Redo 回归与最终全量验收；保留 Provider 凭据和默认可见启动方式的产品级确认项。
- **Browser Workflow Contract 与本地 Agent 配对**：Workflow Bridge 通过版本化浏览器 Contract 进入唯一 Dispatcher/Executor；普通浏览器的 loopback 配对只有在协议认证成功后才重新绑定可见 Workflow，`#/dock` 明确作为开发者连接面，普通 `#/app` 可恢复已保存的本地配对，Agent 无浏览器连接时不再隐式接管 native workspace。
- **Auto Local Agent Bootstrap（Phase F1）**：源码启动器可复用/启动本机 Workflow Agent，等待 WebUI 就绪后直接打开带短期 bootstrap 参数的主 `#/app`；主 App 自动完成认证、清理地址栏并建立 Browser Workflow binding，新增本机 `status --json` 与 `open-flovart` Skill，手动 `/dock` 仅保留为开发者诊断面。
- **Workflow 引用与媒体完整性修复**：修复 @ 引用上一张生成图片后运行报「图生图至少需要引用 1 个媒体节点」的一组根因——原位替换产生的隐藏输入节点不再被排除在 chip/下拉/水合/运行时共享的输入集合之外（别名编号四层一致）；非批量原位重生成只在确认旧 storageKey 无其它持有者（隐藏输入/克隆节点/撤销历史）时才物理删除；被引用媒体文件缺失时抛出指名节点的可行动错误，@ 名称未匹配到已连线节点时给出明确提示而非静默丢弃；mention 徽章与下拉对不可达缩略图（storageKey-only、`asset-library:` 等内部协议）回退类型图标，不再渲染破图。
- **唯一导演入口与 Production Crew 工作面**：DeepSeek 主对话成为 Harness 内唯一指挥入口；Agent 主入口与 Workflow 右侧区不再挂载第二套 Flovart 聊天，改为展示 Director Binding、Workflow Draft、Production 状态与 Receipt 的制作组状态面。默认开发和 Tauri 启动也不再预热 ManagedAgent。
- **DeepSeek Harness 原生 Workflow 画布**：`dsh-plugin/` 在 RC8 `conversation.view` 中直接渲染 React 节点画布，启动器自动准备 Workspace-only Operator；Browser Client 经 Harness Host 的受限同源代理访问 Native Draft，Token 不进入浏览器。新增 Production Brief 引导，激活 Runtime 不再预造空项目，并移除 iframe、手填连接字段和外部侧栏入口。真实 RC8 浏览器已完成 `Production Brief → Draft v2` 验收；崩溃恢复、多会话 Handoff 与失败升级回滚仍待验证。
- **DeepSeek Dock 插件页面（S3B Flovart 侧纵切）**：保留 `#/dock` 作为 Flovart 侧 Production Control、Crew Receipt 和多 Harness 状态的独立/降级入口；`flovart-dock` v1 postMessage 协议继续服务 Dock 控制页，但不再承担 Harness 原生画布的主渲染路径。
- **S1 核心纵切：Crew Intent → Workspace Operator → Workflow → Receipt**：Canonical Registry 新增 `director.*`、`crew.intent.*`、`crew.receipt.get`、`crew.event.watch` 可用命令并重算 registry hash（Node/Rust 共享契约）；Node Workspace Adapter 增加持久 Crew Store（重启恢复、`interrupted` 标记）与确定性 Workspace Operator（draft-only 并行分支意图、对象版本冲突重读、诚实失败）；CLI 经同一 loopback+token 协议握手调用 Crew 命令并支持 `--jsonl` 事件游标；浏览器 Draft Authority 接受 `operator` 来源且不逐命令确认普通可逆编辑。
- **Agent 目标架构**：产品收敛为 External Coding Agent Harness（外部导演）与 Workspace Operator（唯一内置执行 Agent）两个 AI 角色；Production Crew、Dispatcher、Worker 与 Review Tool 都是执行集合或工具/服务。Codex、DeepSeek Harness、Claude Code、OpenCode、Pi 共享 Operation Skill + CLI 模型工具基线，不暴露 Coding Agent MCP Server。
- **DeepSeek Harness Flovart 插件架构调整**：明确 Harness 保持主壳、主会话和默认导演权；专用 Profile/Host/Client Plugin 提供原生 Workflow 画布，Runtime 持有本机 Native Draft，WebUI/Dock 作为 Table、Provider 与恢复降级；保留渐进工具、Runtime 独立存活和兼容集回滚边界。
- **文档收口**：新增 10 份 Agent 设计文档与 ADR 0061/0062，更新领域词、README、功能页、快速开始、进度与 Runtime 文档；删除迁移跳转壳、损坏的 Docker 指南、旧 Agent/Canvas/MCP 快照和已完成施工清单，历史仅由 Git 保留。
- **Skill 与首页入口**：增加本地 Skill Package Registry、Manifest/Hash 校验、安装保护、Hub Client/Store 与 CLI Skill 命令；首页区分内置、本地和 Hub Skill，并从真实创意创建项目与可编辑 Agent 草稿，移除旧 Landing mock。
- **Workflow 创作体验**：统一媒体节点、Poster 优先视频、浮层避让和确定性自动布局；图片、视频与音频处理继续收敛到显式 Operation、Recipe、Input Binding、Take 与语义 ChangeSet。
- **Browser Import V1**：扩展收缩为 Desktop-first 右键单图导入，使用明确配对、Native Messaging 分块、内容 Hash/MIME 校验、内容寻址 Artifact、活动 Workflow 投影或 Inbox；不保存 Provider Secret、不直连 Provider、不常驻整站权限。
- **Production Runtime 与 Provider**：安全本地 Control Plane、持久 Task/Event、Artifact、Production Dry Run、Workflow Projection 与首批 Provider Route 形成基线；RunningHub 使用 Schema 驱动 Route Catalog，剩余 legacy-only 路径、完整取消/账单/恢复与 Draft Authority 转移继续列入待办。
- **分发边界**：Docker Compose 明确降为本地联调用途；正式静态部署、安装签名、Release 附件、Edge 商店、跨平台 Toolkit 与升级回滚仍需真实发行验收。

具体可测试项与尚未确认的边界见 [`docs/content/docs/progress/pending-test.mdx`](docs/content/docs/progress/pending-test.mdx)。
