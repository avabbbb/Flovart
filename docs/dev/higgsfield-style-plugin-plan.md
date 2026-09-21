# Higgsfield 式插件落地方案

本文是把「Flovart 推进为 Higgsfield 式插件」翻译成可执行工作项的操作方案，供后续实现者直接拆解执行。产品边界、状态归属、验收指标一律以[主设计](../design/flovart-native-effects.md)为准；本文不重复定义指标，也不引入主设计之外的新组件。凡标注「代码就绪，待真实宿主验收」的条目，任何证据都必须来自对应宿主真实运行，包构建、mock 契约、单元测试都不算数。

Higgsfield 参照事实来自官方仓库（[higgsfield-ai/cli](https://github.com/higgsfield-ai/cli)、[higgsfield-ai/skills](https://github.com/higgsfield-ai/skills)，均 MIT）：可学其交互规范，代码不复用。

## 1. 定位差异

| 维度 | Higgsfield 插件 | Flovart 插件 |
| --- | --- | --- |
| 能力本体 | 云端生成服务；插件/CLI/MCP 是把同一云端能力分发到各入口的客户端 | 本地 Workflow authority 与本地生成服务；插件/CLI/MCP 是控制同一本地任务函数的入口 |
| 数据落点 | 结果回到宿主 timeline / Media Pool，素材状态由云端任务定义 | 素材版本持久在本地素材目录，任务/Provider ID 在本地 Runtime，工程参数在宿主工程 |
| 生成路径 | clip → 云端生成 → 导回宿主 | 面板/CLI/MCP → 同一任务函数 → Provider 适配 → 持久素材版本 → 原生效果读固定版本渲染 |
| Agent 入口 | CLI + Skill 面向 coding agent（Claude Code/Cursor/Codex），MCP 面向 chat agent | CLI + Skill 是默认外部路径，MCP 只是同一能力的可选协议投影（[ADR 0070](../adr/0070-contract-first-cli-mcp-native-projections.md)） |
| 面板形态 | 宿主内紧凑面板，不嵌入完整工作区 | 同样紧凑面板；Flovart 工作区保持独立入口，需要复杂编排才展开 |
| 凭据 | 云端账号 | local-first BYOK；模型服务账号与 Agent 账号分开，连接引导不改写现有 Plus/OAuth/代理/Provider 配置 |

核心差异一句话：Higgsfield 把云端能力「分发」到各入口；Flovart 把各入口「收敛」到本地同一个任务函数与素材版本。因此不存在「云端同步版 Flovart 插件」这条路线，也不允许面板绕过本地任务函数直连 Provider。

## 2. 表面架构

```text
┌─────────────────────────────────────────────────────────────────┐
│ 宿主（AE / PR → PS → Resolve Studio）                            │
│                                                                 │
│  紧凑面板                         原生效果                       │
│  · 当前对象（图层/片段/选区）      · 参数随宿主工程保存            │
│  · 提示词 / 参考 / 时间范围        · 固定素材版本引用              │
│  · 任务进度 / 取消                · 混合强度等已验证参数           │
│  · 候选版本对比 → 明确应用        · 参与宿主预览与导出             │
│  · 「打开画布」展开 Flovart        · 渲染线程不触网、不等生成       │
└────────┬───────────────────────────────────────┬────────────────┘
         │ 提交/查询任务                           │ 读取固定素材版本
         ▼                                       ▼
┌──────────────────┐   ┌──────────────────────────────────────┐
│ CLI / Skill      │   │ 本地生成服务（src-tauri Runtime）      │
│ （coding agent   │──▶│  同一任务函数 → Provider 适配 →        │
│  默认路径）       │   │  持久素材版本（文件 + 校验和）          │
├──────────────────┤   │  幂等键 / 任务状态 / 恢复 / 费用确认    │
│ MCP（可选投影，   │──▶│                                      │
│  同一能力）       │   │                                      │
└──────────────────┘   └──────────────────────────────────────┘
```

规则（全部来自主设计 §3–§5，逐条对应）：

- 面板只做「当前对象 + 提示词 + 任务 + 候选版本 + 打开画布」。参数修改只形成草稿，点生成才提交任务；不嵌完整 Flovart 工作区。
- 原生效果出现在宿主效果/滤镜入口，参数随工程保存，参与预览与导出；首版参数限于素材版本与混合强度，变换/遮罩/关键帧优先复用宿主能力。单独的网页面板不满足「原生」定义。
- 面板、CLI、MCP 调同一个任务函数；确定性命令不经另一个内部 AI 重新解释；不串联 MCP → CLI 子进程 → 多层代理。
- 渲染函数只用固定文件与宿主当前帧参数：不访问网络、不等待生成、不依赖 Agent/浏览器/生成服务在线。
- 效果任务能力在命令文档中只能标「设计目标/待实现」，实现、schema、验证齐备后才进入 Skill 与 canonical registry（`tools/flovart/contracts/runtime/command-registry.v1.json`）；docs contract 会校验文档命令必须存在于 registry，不许写不存在的命令。
- 五个稳定 Agent 操作面不变：`status`、`workflow.inspect`、`workflow.selection.get`、`workflow.apply`、`workflow.node.run`；现有 Browser Workflow 契约继续有效，不得假称插件可无 UI 运行（`workspaceMode` 仍是 `browser`，无 UI 启动是待验证缺口）。

## 3. 对照 Higgsfield 的 6 条落地差距

| # | Higgsfield 已做到 | Flovart 现状 | 要补什么 |
| --- | --- | --- | --- |
| 1 | 安装器一键装：用户装完即用，不手配端口/Token/Session | `integrations/studio/` 只有面板包构建（`npm run studio:build` → `dist-studio/`），无安装器，无宿主自动发现 | Windows 安装器：发现宿主 → 安装 AE/PR 组件 → 本地服务自动发现面板连接；未检测到宿主时说明缺什么和支持版本，PATH 检测 ≠ 安装成功 |
| 2 | 宿主内 tracer 闭环：当前 clip → 生成 → 导回 timeline/Media Pool | 面板仍是「等待注入回调」形态；AE 是 CEP 面板 + `host.jsx` 桥；无原生效果 | AE 原生效果小样先行（固定本地素材 + 混合参数 + 保存重开 + 离线导出），再 PR 适配；宿主证据按 `integrations/studio/*_REAL_HOST_CHECKLIST.md` 采集 |
| 3 | Skill 对话 UX：不回显 raw ID/JSON、不暴露 polling/job 内部、自动选合理默认 | `skills/flovart/SKILL.md` 已有等价对话规则（不回显 ID、失败先 inspect、一次自动恢复） | 保持规则不变；把新效果命令纳入同一 Skill 的对话口径；效果类命令实现前不得写入 `skills/flovart/commands/` |
| 4 | 本地路径自动物化：agent 给本地文件路径即自动上传 | CLI 的 `generate.image`/`generate.video` 只收 `sourceImageIds`/`sourceVideoIds`（已入库素材 ID），没有「本地路径 → 素材」入口 | 在本地服务做受限路径读取与物化（路径校验、授权范围），与 todo「轻面板与素材入口」中的目录授权工作合并，不在前端猜路径 |
| 5 | `--wait` 一步等待 + timeout 后 rejoin 同一 job 不重复提交 | Runtime 有 `task.get`/`task.resume`/幂等键；CLI 侧没有一步 wait/rejoin 语义暴露给 agent | CLI 任务命令补 `--wait` 与 timeout rejoin：超时返回同一 `taskId` 与恢复指引，同一幂等键重提不重复提交；Provider 已提交但回执丢失时按「待核实」查询原任务 |
| 6 | 每个入口一页文档 | 现有 `skills/flovart/commands/*.md` 按命令分页；宿主侧只有 checklist | 按入口补齐一页式说明：宿主面板（本计划 §4 工作项落地后）、CLI/Skill（现有 SKILL.md 扩展）、MCP（现有 OPERATION_SURFACE 一节）；每页只写已实现的命令 |

## 4. 工作项（按主设计 §8 里程碑切分）

每个工作项只写「目标 / 最小实现 / 完成证据 / 对应路径」。一个切片未通优先修该切片，不靠增加抽象层或扩展宿主数量解释失败；任何 Manager/Facade/Runtime/Provider/Gateway 新壳层都违反主设计 §5.2。

### M1 — AE 固定素材原生效果 + PR 兼容验证（主设计 §8 第 1 行）

**W1.1 AE 原生效果小样**

- 目标：在 AE 效果入口出现一个 Flovart 效果，读取一个固定本地素材，暴露混合强度参数，随工程保存。
- 最小实现：`integrations/studio/after-effects/` 下新增 C++ Effect SDK 源码目录（如 `effect/`）与构建入口；效果渲染只读固定文件 + 当前帧参数，不触网。先用固定资产证明宿主接入，不调用模型。
- 完成证据：参数可见并可调、关键帧可用、随机帧读取正确、保存重开参数不丢、关闭本地服务后仍可导出——全部在真实 AE 中录屏验证，更新 `integrations/studio/AFTER_EFFECTS_REAL_HOST_CHECKLIST.md` 结论。**代码就绪 ≠ 已认证，真实宿主是 External Gate。**
- 路径：`integrations/studio/after-effects/`（新增 effect 源码）、`integrations/studio/build.mjs`（增加效果构建产物检查）、`integrations/studio/AFTER_EFFECTS_REAL_HOST_CHECKLIST.md`。

**W1.2 紧凑宿主面板改造**

- 目标：现有 CEP 面板从「注入回调的 contextual inspector」改为「当前对象 / 提示词 / 任务 / 候选版本 / 打开画布」的紧凑单列面板。
- 最小实现：面板与本地服务的连接由安装器/本地服务自动发现；未选择对象时只显示「请选择图层或片段」；参数修改只是草稿，点生成才提交；候选版本由用户明确应用，晚到结果不覆盖已选版本；「打开画布」跳转 Flovart 工作区。UXP/CEP 不是完整浏览器，不搬整套 React UI，共享业务函数和文案。
- 完成证据：真实 AE 中完成一次「选图层 → 生成 → 候选对比 → 应用版本」录屏；面板无凭据字段（`build.mjs` 已有的 credential-shaped 检查继续生效）。
- 路径：`integrations/studio/after-effects/index.js`、`index.html`、`cep-bridge.js`、`host.jsx`、`integrations/studio/shared/inspector.js`、`shared/host-contract.js`。

**W1.3 PR 适配验证**

- 目标：同一效果核心在 PR 中可用（片段范围、Effect Controls、时间线导出）。
- 最小实现：能共用的渲染函数放同一源码文件，宿主差异留在入口；不预建通用 Host SDK。Premiere UXP 基线 25.6+；Hybrid（26.2+）仅在确有需要时使用，且 Hybrid 加载 C++ ≠ 注册原生视频效果。
- 完成证据：真实 PR 中参数/像素格式/线程/时间映射逐项验证记录；AE/PR 共用源码但分别构建、分别验收，不发布同一二进制声称免测。
- 路径：`integrations/studio/premiere/`、共用效果源码目录、`integrations/studio/PREMIERE_REAL_HOST_CHECKLIST.md`。

**W1.4 Windows 安装器与宿主发现**

- 目标：一个安装器完成「发现宿主 → 选择安装 AE/PR 组件 → 打开面板即可用」。
- 最小实现：宿主检测按真实安装路径与版本核验（声明只写实测版本）；面板连接由安装器/本地服务自动发现，不要求手填端口、Token、Session ID；未检测到宿主时列出缺少的宿主与支持版本。
- 完成证据：未参与开发的 Windows 机器上从安装到面板连接成功（主设计 §6.2「安装与首次使用」行验收）。
- 路径：安装器源码归属现有发行打包链路（`src-tauri/` 安装产物 + `integrations/studio/` 组件落地）；宿主发现逻辑复用 `tools/flovart/host-discovery.js` 的现有约定，不新造发现协议。

### M2 — 单任务真实生成、持久素材版本、候选应用（主设计 §8 第 2 行）

**W2.1 同一任务函数落地**

- 目标：面板与 CLI 提交的是同一个生成任务函数：固定输入快照 + 目标引用 + 幂等键 → Provider 适配 → 持久素材版本。
- 最小实现：优先复用 `src-tauri/src/runtime/` 的任务、文件、Provider（`tasks.rs`、`worker.rs`、`production_task.rs`、`runninghub.rs`、`google_veo.rs` 等现有适配）；TS 侧输入整理只抽离必要纯函数（`services/workflowExecutor.ts`、`components/workflow/inputResolver.ts` 的输入语义），不得在 Rust 与 Node 各新增一套调度器。请求摘要含输入文件指纹、时间范围、提示词、参考、模型与参数；非秘密规范化输入需保存，不能只存 hash。
- 完成证据：同一请求摘要 + 同一幂等键从面板与 CLI 各提交一次，只产生一个任务；不同参数不能复用同一幂等键。
- 路径：`src-tauri/src/runtime/tasks.rs`、`worker.rs`、`contracts.rs`、`registry.rs`；TS 纯函数来源：`services/workflowExecutor.ts`、`components/workflow/inputResolver.ts`。

**W2.2 无 UI 启动与 Provider 等价核对**

- 目标：只开宿主和本地服务即可生成，不要求打开 Workflow（该项是主设计 §1 的推荐假设，实现前需核对确认）。
- 最小实现：给 `src-tauri/src/runtime/control_server.rs` 补无 UI 独立启动入口；逐项核对现有 Provider 能力在 Runtime 侧与前端等价；目标 Provider 在 Runtime 不可用时明确记录迁移缺口，不写新的生成网关掩盖差异。Browser Workflow 契约不变：`workspaceMode` 仍为 `browser`，Workflow 类命令仍要求可见工作区；「效果任务可无 UI」与「Workflow 命令可无 UI」是两件事，后者不做。**进度（代码就绪，待真实宿主验收）**：`POST /v1/commands`（`generate.image`/`generate.video`/`task.*`）+ `GET /v1/tasks/:id` + `GET /v1/artifacts/:taskId` 已构成面板无 UI 提交→轮询→下载闭环；`actor.kind` 增加 `panel`；端到端证据见 `src-tauri/tests/runtime_control_server.rs::panel_can_submit_poll_and_download_an_artifact_without_a_browser`。
- 完成证据：不打开 Flovart 前端，宿主面板与 CLI 各完成一次真实生成；等价性核对清单逐项记录。
- 路径：`src-tauri/src/runtime/control_server.rs`、`discovery.rs`、`auth.rs`、`tools/flovart/runtime-client.js`。
- 裁决（.tmp/adversarial/verdict.md，2026-09-20）：面板↔业务层第一步采信 Runtime 直连（Advocate-A）。Browser-Link 注入（Advocate-B）被驳回为宿主面板链路——`__FLOVART_*` 全局写进 Flovart 浏览器 window，真实宿主面板在独立进程读不到；保留 B 的 `installStudioBrowserLink`/`createBrowserWorkspaceAdapter` 作为 W1.2 工作区内 preview 面板的自宿主实现，不得作为宿主侧链路。W2.4 须在 `generate.*` 上补费用确认分支；W2.1 须为 `generate.*` envelope 增可选 `projectId`/`outputTarget` 以钉住 executionTarget。

**W2.3 持久素材版本与候选应用**

- 目标：素材版本是唯一持久事实（ID、来源任务、文件、校验和、尺寸、帧率/帧数、色彩与 Alpha、配方摘要）；候选由用户明确应用，效果实例保存已应用版本 + 混合参数。
- 最小实现：先下载到暂存文件，校验后原子提交到持久素材目录；文件齐全才把任务标完成；效果保存精确版本与相对素材引用，不保存临时 URL/Blob/base64/媒体字节；复制效果默认复用固定版本，首次编辑生成配方时建立独立实例身份；移动素材目录后可重定位并按校验和验证，不按文件名误配；导出前检测缺失，失败或明确旁路，不静默导出错误内容。
- 完成证据：主设计 §6.2「持久性」「版本操作」两行：12/12 保存重开并离线导出；应用 V1/V2、撤销重做、复制效果、另存工程、移动目录全部行为正确。
- 路径：`src-tauri/src/runtime/store.rs`、`worker/local_media.rs`、`migrations/`（如需扩展任务/Artifact 字段）；效果实例字段存宿主工程（`integrations/studio/after-effects/` 效果参数侧）。

**W2.4 真实 Provider 与故障恢复**

- 目标：一个短片段接到真实 Provider：固定输入、范围、提示词、模型，返回同一持久任务，覆盖失败、取消、提交未知。
- 最小实现：任务主状态 `queued → running → completed | failed | canceled`；Provider 已提交但回执丢失标「待核实」并查询原任务，不盲目重提；取消停止后续工作，Provider 无法取消时如实显示「已请求取消，供应商可能仍计费」；UI 关闭不取消生成，恢复只读已有状态；首版单机顺序队列，不引入 Redis/消息总线。
- 完成证据：主设计 §6.2「幂等与恢复」行：双击、断连、回执丢失、进程中断、晚到结果各 5 次无重复自动提交、无跨目标写入、无错误版本覆盖。
- 路径：`src-tauri/src/runtime/tasks.rs`、`worker.rs`、`events.rs`、`error.rs`。

### M3 — CLI/Skill 同一业务入口 + Codex 双入口（主设计 §8 第 3 行）

**W3.1 CLI 任务命令补 `--wait` 与 rejoin**

- 目标：coding agent 一步等待任务完成；超时后能 rejoin 同一任务而不重复提交。
- 最小实现：在现有 canonical registry 中为已实现的命令补 `--wait`/`--timeout` 参数（先覆盖 `task.get`/`task.list`/`task.cancel`/`task.resume` 与生成命令的真实等待语义）；timeout 返回同一 `taskId`、同一幂等键的重提语义与用户可读恢复指引；`--wait` 只是阻塞读取已有状态，不是新的执行路径。新效果命令（如效果目标的生成/应用）只有实现 + schema + 验证齐备后才进 registry 与 `skills/flovart/commands/`，此前在文档中一律标「设计目标/待实现」。
- 完成证据：对同一幂等键重复提交不产生第二个任务；Ctrl-C/断网后用同一 `taskId` rejoin 恢复原任务；契约测试覆盖 normalized/state-hash parity。
- 路径：`tools/flovart/cli.js`、`runtime-command-surface.js`、`contracts/runtime/command-registry.v1.json`、`skills/flovart/commands/`。

**W3.2 本地路径自动物化**

- 目标：agent 在命令里给本地文件路径（参考图/源片段），本地服务自动物化为素材引用。
- 最小实现：本地服务新增受限目录读取接口，做路径校验、授权范围与最小权限；不在前端猜路径，不把目录授权声明成已贯通。物化产物进入持久素材目录并登记校验和，与 `ingestWorkflowMedia` 的导入副本语义分开，不共用同一存储实例（todo「轻面板与素材入口」同项合并执行）。
- 完成证据：CLI 传本地路径完成一次真实生成，素材目录中可追溯校验和；越权路径拒绝并给结构化错误。
- 路径：`src-tauri/src/runtime/control_server.rs`、`worker/local_media.rs`、`tools/flovart/runtime-client.js`。

**W3.3 Skill 对话 UX 对齐**

- 目标：Skill 的对话规则覆盖新效果任务：不回显 raw ID/JSON、不暴露 polling/job 内部、自动选合理默认、`--wait` 一步等待、timeout 后 rejoin 同一任务不重复提交、本地路径直接可用。
- 最小实现：`skills/flovart/SKILL.md` 的 Conversation rules 与 intent mapping 扩展效果类意图；新增命令页只在命令真实存在后写入 `skills/flovart/commands/`；保留现有五条稳定面与 Browser 绑定说明，不宣称插件可无 UI 运行。
- 完成证据：真实 coding agent（Claude Code / Codex / OpenCode）按 Skill 完成「选中对象 → 生成 → 等待 → 应用版本」的 tracer 会话记录；docs contract 校验通过（文档命令全在 registry）。
- 路径：`skills/flovart/SKILL.md`、`skills/flovart/commands/`、`skills/flovart/scripts/`。

**W3.4 MCP 可选投影对齐**

- 目标：MCP 仍是同一能力的可选投影，不扩成第二运行时；效果类工具实现后再按同样门槛加入。
- 最小实现：`tools/flovart/mcp-server.js` 保持 stdio + 五工具稳定面；新增工具必须先在 canonical registry 有对应命令且通过 parity 测试；错误保留 `code`/`retryable`/`details`，不伪装自然语言成功；不串联 MCP → CLI 子进程。
- 完成证据：schema 对齐与跨 projection parity 测试；真实 MCP 客户端会话证据（仍是 External Gate）。
- 路径：`tools/flovart/mcp-server.js`、`agent-surface.js`、`operation-gateway.js`。

**W3.5 Codex 双入口**

- 目标：外部 Codex 走 Skill/CLI 调用效果任务；内部经官方 app-server 承接会话、事件与审批。
- 最小实现：app-server 优先本地 stdio、锁定版本；实验性接口与 WebSocket 限制必须另做登录与恢复验证（[官方文档](https://developers.openai.com/codex/app-server)）；不为 Codex 另加 MCP 入口（见 §6 不做清单）。
- 完成证据：真实 Codex 会话完成效果任务的工具回执与宿主结果；登录/恢复实测记录。
- 路径：`tools/flovart/agent-kit.js`、`local-agent.js`、`ensure.js`；内部入口按 app-server 实测结果定落点。

### M4 — PS 滤镜 + WorkBuddy 双向（主设计 §8 第 4 行）

**W4.1 PS 原生滤镜**

- 目标：PS 中以滤镜 + 选区 + 可回编参数验收，不套视频关键帧语义。
- 最小实现：PS C++ Filter SDK 滤镜，复用已验证的素材版本与任务函数；选区、滤镜参数、智能滤镜可行性、保存重开逐项验证。
- 完成证据：真实 PS 中完成「选区 → 生成 → 应用 → 重开」；[PS 滤镜与 Hybrid](https://developer.adobe.com/photoshop/uxp/guides/hybrid-plugins) 核对记录。
- 路径：`integrations/studio/photoshop/`（新增 filter 源码）、`PHOTOSHOP_REAL_HOST_CHECKLIST.md`。

**W4.2 WorkBuddy 双向接入**

- 目标：外部连接器在 CLI + Skill 与 MCP + Skill 中选一个包形态（不混装）；内部用官方本地助理 API。
- 最小实现：本地助理 API 需应用审核、scope、用户授权、HTTPS 平台访问，不宣传完全离线；本地助理状态/历史与云端 ACP 流不同，不推断相同流式能力（[连接器](https://open.workbuddy.cn/docs/connector)、[第三方应用](https://open.workbuddy.cn/docs/third-party-app)、[Open API](https://open.workbuddy.cn/docs/openapi)）。
- 完成证据：真实 WorkBuddy 客户端导入、自然语言调用、授权与回执记录。
- 路径：`skills/flovart-workbuddy/`、`integrations/workbuddy/`、`tools/flovart/agent-kit.js`。

### M5 — Resolve Workflow Integration + OpenFX（主设计 §8 第 5 行）

**W5.1 Resolve 双件验证**

- 目标：Workflow Integration 做 Media Pool/时间线联动，OpenFX 做固定版本渲染；两者分别验收。
- 最小实现：Workflow Integration 不是 Inspector 效果控件，OFX 单独走 [OpenFX](https://github.com/AcademySoftwareFoundation/openfx)；先修复「导入文件后立即删除暂存路径」的媒体生命周期问题（主设计 §5.1 已列风险），验证宿主是否复制媒体，正式素材不依赖该行为；Studio 版本与 OS 条件以安装包实测为准（[Resolve Studio](https://www.blackmagicdesign.com/sg/products/davinciresolve/studio)）。
- 完成证据：对应 Studio/OS 版本实测记录；不能只交独立 Electron 窗口冒充原生效果。
- 路径：`integrations/studio/resolve/`、`RESOLVE_REAL_HOST_CHECKLIST.md`、OFX 源码新目录。

### 贯穿项（不属于单一里程碑）

- **素材/任务最小字段**：优先扩展已有 task/Artifact 结构（`src-tauri/src/runtime/store.rs`、`migrations/`），不为每个名词建表建类；语义字段清单以主设计 §4.2 为准。
- **固定评测集先行**：12 个 5s/1080p/24fps/SDR 片段 + 4 个合成序列 + PS 阶段 6 张静态图，原始记录放 `artifacts/native-effects/`；建立评测集是 M1 验收的前置，不属于任何单一工作项。
- **每入口一页文档**：宿主面板页、CLI/Skill 页（`skills/flovart/`）、MCP 页（`docs/design/ecosystem/OPERATION_SURFACE.md` 对应小节）；每页只写已实现命令，效果命令实现前标「设计目标/待实现」。

## 5. 验收矩阵

验收方法与通过线统一引用[主设计 §6.2 验收矩阵](../design/flovart-native-effects.md#62-验收矩阵)，本文不复造指标。执行时只跑当前切片影响的行：协议用契约测试，原生效果必须进真实宿主，文档修改只跑文档和链接检查；评测原始记录与脱敏录屏放 `artifacts/native-effects/`，真实 key 不进入证据。任何「已认证」措辞必须能指到对应宿主/Agent 的真实运行证据，否则一律写「代码就绪，待真实宿主验收」。

## 6. 明确不做

- 不做 Flovart Cloud、账号体系、计费系统；社区分发沿用现有作品/Remix 逻辑，不另建市场。
- 不做技能市场：第一阶段只做官方配方与安装入口（Production Skill 包复用现有机制）。
- 不把完整 Canvas/工作区塞进宿主 iframe 或面板；面板只保留「当前对象 / 提示词 / 任务 / 候选版本 / 打开画布」，复杂编排展开 Flovart。
- 不为 Codex 加 MCP：Codex 外部走 Skill/CLI，内部走官方 app-server；MCP 只服务需要它的宿主（如 TeleAgent），一个 WorkBuddy Connector 不混装 CLI 与 MCP。
- 不新造 Manager/Facade/Runtime/Provider/Gateway/通用 Host SDK/插件内核；仅转发参数的层不成立。
- 不做 macOS 同期承诺：首版安装包与验收限定 Windows，措辞固定为「Windows 优先，macOS 后续验证」。
- 不做自动人物分割、跟踪、变速、倒放、HDR、超长片段：首版整段短素材替换 + 宿主遮罩混合；未测能力明确标不支持，不静默拉伸帧数。
- 不把 Browser Workflow authority 迁进 Runtime DB，不做 native/headless Workflow fallback；现有 Browser 工具契约在代码改造前继续有效。
