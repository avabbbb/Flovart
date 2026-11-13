# AGENTS.md

本文件约束 Flovart的 AI / 自动化开发。优先级：系统/开发者指令 > 用户当前明确要求 > 本文件 > 项目文档。用户已确认的新决定覆盖旧稿；历史文档不得反向改变当前产品方向。

## 0. 品牌规则

- **对外产品名称统一为 Flovart**：新 UI、标题、按钮、宿主面板、README 和当前文档不再引入 Iris 品牌。
- CLI、Skill、package、环境变量和命令中已有的 `flovart` 保持不动。
- 旧 `iris-*` 的数据库字段、协议字段、持久化 key、兼容 ID 与已存素材路径保持兼容，不做全局替换；纯展示、CSS 和新导出文件名可以清理。
- 当前 canonical GitHub repository 经核验为 `avabbbb/Flovart`。仓库或协议迁移不得混入普通品牌清理。
- 历史归档和更名前的视频可保留原始名称，引用时说明历史背景。

## 1. 开始前先确认当前事实

开始任何实质修改前，先读：
1. `docs/index.md`
2. 与任务相关的 current-truth 文档
3. 真实代码与 `SUPPORT_MATRIX.md`

产品与系统目标由 `docs/design/00-overview.md`（总体设计）定义；所有交互遵守 `docs/design/01-interaction.md`（简单直接、不硬编码、不死锁）；模块细节见 `docs/design/1x-*.md`。不要从 archive、旧 audit、release evidence 或 Git 历史推导当前需求。

会变化的 SDK、宿主 API、许可证、模型/Provider 能力必须按当前日期核验官方文档和真实源码。构建通过、mock 通过、manifest 存在都不等于真实宿主/账号已认证。

## 2. 当前产品边界

产品目标（三个场景）：

1. **游戏素材替换**（暂缓，当前不在 Reverse 中提供）：把游戏复刻 demo 里占位的美术与音效，用 Flovart 批量替换为可发布的原创素材；Agent 自动执行，并记住用户的个人美术风格偏好（memory）。
2. **爆款视频逆向**：像 Hypit 一样把爆款视频拆成 Script → 转写证据 → 对齐 → Timeline → 轨道，再用用户自己的 AI 数字人角色批量、高并发、低时延地制作变体，支持快速投流。
3. **剪辑宿主插件**：在达芬奇 / 剪映中作为插件，Agent 直接读取时间轴、图层和素材库作为上下文，不需要用户再手动上传；可对指定片段做人物替换、绿幕背景、AI 特效，或生成剪辑用素材。

顶级产品 surface 固定为 **Canvas | Reverse | Agent**（原 Table 位改为 Reverse，不再保留 `table` 视图）：

- **Canvas**：空间化 Workflow，用户与 Agent 操作同一份可见生产状态。
- **Reverse（逆向）**：按 Hypit 代码架构与功能复刻的视频逆向工作台（Studio 式：库 / 预览 / 时间线 lane / Inspector）。二次开发：逆向工程可一键转成 Canvas 上的子画布节点，双击子画布回到 Reverse；两边走同一 `workflow.apply` 边界联动。详见 `docs/design/11-reverse.md`。
- **Agent**：本地/外部 Coding Agent 的发现、准备、状态与切换中心。
- **Assistant / Context / History**：只在 Canvas / Reverse 的 contextual drawer 中，不复制到 Agent 页。

  Hypit 复刻边界：以 gitignored 的 `_ref/hypit` 为参照，对齐包分层、数据模型、术语与数据流，代码在 `services/reverse/` 自写；不复制 Hypit 源文件，不把 `@hypit/*` 打进 bundle（附加条件的 Apache-2.0 要求衍生品同许可、禁止商业再分发与多租户托管，与本仓库 MIT 冲突）。WhisperX / ffmpeg / 渲染等本地能力走本地 Runtime 或用户自装的 hypit CLI，结果作为 durable artifact 导回。

  不要重新引入 Agent full-page chat、Tasks/Artifacts/Context 工作区、Production Crew / Director / Operator 必经层、Production Skill Marketplace 或第二套 Canvas/Workflow。多步制作（如 Agent 视频流水线 run）的对话与 trace 只放在 Canvas 的 Assistant drawer（对话 + 运行日志分区）与画布本身；Agent 页最多放只读的跳转链接，不放对话或 run 编辑。

  外部 Agent 默认走 **Skill + CLI**；MCP 是同一 operation contract 的可选投影。内置 Assistant、宿主面板和外部 Agent 必须复用同一业务能力与权限边界

## 3. 首要工程原则：短路径、单一权威

- 同一能力只保留一份业务实现；CLI/MCP/Host adapter 只做参数、权限上下文与结果转换。
- 同一任务只有一个 durable identity 和一份状态；重试依赖幂等与查询，不复制任务。
- 只有出现第二个真实复用场景、独立状态所有权或必要进程/凭据边界时才抽模块。
- 不新增只转发的 Manager / Facade / Coordinator / Repository 层，不为未来假设建通用总线。
- 确定性工具直接执行，不再交给第二个模型重新解释。
- 不因“精简”删除目标绑定、revision、幂等、取消、错误恢复、费用授权、素材持久化或权限校验。
- 不顺手改无关文件；保护已有用户改动。替换旧实现时，只删已证明被当前路径取代的部分。

## 4. Workflow、生成与素材

当前 Browser Workflow 仍是稳定 Agent operation 的可见权威；迁移 authority 必须先改 contract，再改实现和文档。

稳定 model-facing baseline：
- `status`
- `workflow.inspect`
- `workflow.selection.get`
- `workflow.apply`
- `workflow.node.run`

生成路径保持：

```text
UI / Agent / Host entry
→ same generation/business function
→ Provider adapter
→ durable artifact/version
→ Workflow / Reverse / Host consumer
```

素材需要稳定来源、版本与校验信息；临时 URL、聊天消息、base64 不能冒充 durable artifact。晚到任务不能覆盖用户已选择的新版本。

## 4.1 Agent 视频流水线（PROPOSAL）

提案见 `docs/design/16-agent-video-pipeline.md`（能力矩阵、工具集、trace 模型、放置决定、分阶段计划、验收）。被接受前，以下规则约束相关施工：

- **trace 是唯一权威**：一次多步制作是一个 run（durable `runId`），由本地 Runtime 保存 run → step → tool call → artifact → version → review round；Step 由命令边界自动记录，不让模型自己“写日志”。会话只存 `runId` 引用。
- **工具只投影已有业务函数**：pipeline 工具（`pipeline.run.*`、`asset.import`、`audio.tts`、`audio.transcribe`、`timeline.align`、`composition.patch`、`composition.render`、`media.probe`、`media.frames`、`review.submit`、`run.archive`、`capture.ui`）先有业务实现，再登记 canonical registry；内置 Assistant、CLI、MCP、DSH 同一份 schema 与权限。它们只在 run 激活时加载，不进入稳定 baseline，认证后才按 Support Matrix 升级。
- **不开放任意执行**：内置 Agent 不得获得 shell、任意文件读写或任意 ffmpeg 参数；跑用户仓库、注入演示数据、截图录屏这类步骤交给外部 Coding Agent，结果以 `asset.import` 带回同一 run。
- **评审循环可审计**：每轮评审写成结构化 findings（具体时间点 / 片段、层、问题、修法、结论）；修补必须基于版本号，不得改动 locked 片段，除非显式解锁并留痕；轮数受 run 预算上限约束。
- **素材全部 durable**：截图、底片、干声、转写证据、静帧、每一版渲染都是带 sha256 的 artifact；被否掉的版本标记 rejected 保留，不删除。
- **本机执行**：渲染（Remotion）、转写（WhisperX / hypit CLI）、ffmpeg / ffprobe 在本地 Runtime；云端只做 Provider 生成（Seedance、MiniMax speech、文本 LLM）。依赖缺失返回 `CAPABILITY_UNAVAILABLE` 与诊断动作，不静默跳过。
- **费用**：run 级预算（任务数 / 金额 / 最大评审轮数）一次确认，复用 spend mandate 与 Runtime gate；范围变化重新确认。

## 5. Creative host / native effect 规则

宿主扩展只是 projection，不建立第二套 Workflow、Provider、任务或资产系统。共同产品边界以 `docs/design/14-creative-hosts.md` 为准；Resolve 实现还必须遵循 `integrations/studio/resolve/PRODUCT_UI_SPEC.md`。

共同硬边界：

- **宿主轻面板**负责当前 selection → intent/reference → plan → generate → import；复杂编排打开 Flovart Canvas。
- **native effect / OFX**负责宿主参数、关键帧、固定版本预览与导出；render callback 不联网、不等待模型、不依赖 Agent/Flovart 在线。
- 面板/Effect 默认新增结果，不静默覆盖当前素材；替换必须显式且可恢复。
- UI 跟随宿主主题、密度、键盘/焦点和尺寸约束，不把完整 Web Canvas 缩进窄面板。

Host-specific：

- **DaVinci Resolve Studio 21.1 first**：Agent 宿主操作优先使用 Blackmagic native MCP；Flovart Skill + legacy `flovart` CLI 提供生成与 Artifact。现有 Workflow Integration 只做轻面板 / fallback adapter，OFX 后置。不要创建第二套 Resolve MCP，也不要为每个 Scripting API 建 Flovart wrapper。
- **Resolve UI**：实现前先读 `integrations/studio/resolve/PRODUCT_UI_SPEC.md`，并重新打开 Blackmagic 当前 Edit / Cut / Media 官方页面核对视觉。面板必须是 Resolve-native-feeling contextual inspector，不是聊天页、后台 dashboard 或缩小版 Canvas。
- **After Effects**：当前 CEP + C++ Effect SDK 工作保留为 Experimental，但暂停作为第一宿主 gate；不要继续扩张，除非当前 Resolve-first 切片明确需要共享修复。
- **Photoshop / Premiere**：按其当期官方 UXP host API 和 manifest 约束实现，不把浏览器 API 支持度投射到 UXP。
- Provider key、Agent token、Plus/OAuth 或用户私有凭据不得进入宿主工程、Skill、日志或素材 metadata。

真实宿主认证至少覆盖：安装、选择/目标绑定、生成/导入、取消/失败、保存重开、素材缺失、离线导出；native effect 还要覆盖参数持久化、随机帧、色彩/alpha/帧率与关键帧。

## 6. UI 与交互

- 复用现有 CSS 变量、Ant Design token 与 container-driven layout；不要重新引入 viewport inset 补丁。
- 新 UI 必须挂到真实入口并验证可见路径；未挂载组件或 mock-only 面板不算交付。
- PromptBar、ElementToolbar 和原始媒体比例行为按现有产品保持。
- 持续任务显示真实状态，不能用动画掩盖未知提交、失败或 Provider 未响应。
- 宿主面板优先单列、当前选择优先、一个主 CTA；高级设置折叠。完整历史/依赖/复杂 Workflow 回 Canvas。
- Resolve P0 的唯一安全输出是 **Add to Media Pool**；P1 才允许 Add to new track，P2 才做 Replace/Commit。实现 Agent 不得为了“更像成品”跳过非破坏性阶段。
- Resolve 外部 Agent 的聊天保留在 Codex/Claude 等原宿主；Flovart panel 只显示 context / plan / task / candidate / confirmation。

## 7. 代码边界

- Web：React + TypeScript + Vite + Ant Design + Tailwind + Zustand，以 lockfile 为准。
- 网站后端：Go + Gin + GORM，沿用现有 handler/service/repository/model 分工。
- Local Runtime：Rust/Tauri；CLI/Agent：Node。不要为原生效果复制第二套调度器。
- Workflow：`components/workflow/`、`stores/workflow/`；Reverse：`components/reverse/`、`services/reverse/`（参照 `_ref/hypit`，不提交）；Agent：`components/agent/`；宿主：`integrations/studio/`。
- 浏览器业务数据用 localforage；localStorage 只放极小配置。宿主长期素材必须是 durable file/artifact。
- 新增数据表同步 `docs/content/docs/backend/backend-database.mdx`，不要用未来字段冒充已建表。

## 8. 验证与发布口径

- 测试匹配改动风险：文档跑 docs/link checks；代码跑相关测试；宿主/原生效果进真实应用。
- **普通开发 / PR 走快速通道**：本地 Agent 只跑与当前改动直接相关的一轮验证，不得在每次小改后重复全仓测试、10x 稳定性、完整 Benchmark、全平台打包或发布审计。若本地环境缺 SDK / 宿主 / 依赖，明确写 `NOT_RUN locally`，可把普通 PR 的确定性验证交给 GitHub Actions，而不是为了“先验全绿”反复卡住施工。
- **重门禁只在该出现的阶段出现**：10x critical、完整 FlovartBench、依赖审计、CodeQL、Rust/sidecar 发布验证与全平台安装包属于 main / scheduled / manual / release qualification；普通 PR 不把这些当合并前置。Tracked secret audit、目标/revision/幂等、unknown-after-submit、不授权的破坏性/外部写入等真实安全边界仍然 fail-closed。
- 真实支持状态只由 `SUPPORT_MATRIX.md` 升级；旧 RC 数字、旧截图和旧 build 不能证明当前版本。
- Provider 认证需区分 Fake fixture 与真实账号、扣费、429、取消和 unknown-submit。
- 不宣传未验证的实时生成、宿主 Stable 支持、完全离线、云同步、无缝 Agent 登录态迁移或跨平台等价性。
- 浏览器验收使用仓库规定的 Chrome for Testing / 动态隔离端口；临时测试文件放项目 `.tmp/` 或 `artifacts/`。

## 9. 文档治理

`docs/index.md` 定义 current truth。原则：

- `docs/design/` 最多 10 份：总体设计、交互设计、每个模块一份、质量与治理。不要新增并列 CURRENT / TARGET / AUDIT / GOAL / HANDOFF 决策文档；超过 10 份先合并。
- 产品变化更新 `00-overview.md`；交互与布局变化更新 `01-interaction.md`；模块变化更新对应模块文档；新增模块才新增模块文档。
- `skills/flovart/` 是 canonical Skill package；`.agents/skills/flovart/`、`.claude/skills/flovart/` 等是兼容投影 / committed snapshot。不要反转 source-of-truth，也不要手工让这些投影漂移。
- 新 proposal 必须明确 **PROPOSAL / REFERENCE**，被接受后蒸馏进 current truth，再删除或归档 proposal。
- `todo.mdx` 只放未完成；已实现但需现实验证移到 `pending-test.mdx`；验证后再更新 features。
- 历史施工包、README audit、阶段性 launch checklist 不留在 active tree；有长期价值的只保留一份简短 archive snapshot，细节由 Git history 保存。
- README 保持 outcome-first，同时严格跟随 Support Matrix；不要复制内部 transport、端口或过时测试数字。

## 10. 提问与执行

只在答案会实质改变产品范围、不可逆数据/发布行为或实施路线时 ASK；一次只问一个关键问题并给建议。用户已明确要求直接执行时，不为常规编辑、验证和收尾重复索要许可。

回答使用中文，并明确区分：**已实现 / 已验证 / 设计目标 / 假设**。

## 11. 发版本

只有用户明确要求发版本时才执行版本流程：整理 CHANGELOG、提升 VERSION、提交当前授权范围内的改动并打 tag。不要自行发布、推送第三方商店或做未授权的生产签名。
