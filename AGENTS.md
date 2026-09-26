# AGENTS.md

本文件约束 Iris（原 Flovart）的 AI / 自动化开发。优先级：系统/开发者指令 > 用户当前明确要求 > 本文件 > 项目文档。用户已确认的新决定覆盖旧稿；历史文档不得反向改变当前产品方向。

## 0. 品牌迁移规则

- **对外品牌统一使用 Iris**：README、网站标题、宿主面板、用户文案、宣传和新截图不得继续把 Flovart 当作当前产品名。
- **技术兼容标识暂时保留 `flovart`**：CLI 命令、npm/package 名、`.agents/skills/flovart/` 与镜像 Skill 路径、`tools/flovart/`、事件名、CSS/data attributes 等不得在没有迁移计划和兼容 alias 的情况下批量重命名。GitHub 仓库已正式改名为 `avabbbb/Iris`。
- 看到旧文档中的 Flovart 时，先判断它是“品牌文案”还是“兼容标识”。品牌文案改为 Iris；兼容标识保持原样，除非当前任务明确包含迁移。
- 仓库改名、CLI 改名、包 scope 改名属于独立 migration，不和普通 UI/文档 PR 混做。

## 1. 开始前先确认当前事实

开始任何实质修改前，先读：
1. `docs/index.md`
2. 与任务相关的 current-truth 文档
3. 真实代码与 `SUPPORT_MATRIX.md`

产品与系统目标唯一由 `docs/design/flovart-native-effects.md` 定义。不要从 archive、旧 audit、release evidence 或 Git 历史推导当前需求。

会变化的 SDK、宿主 API、许可证、模型/Provider 能力必须按当前日期核验官方文档和真实源码。构建通过、mock 通过、manifest 存在都不等于真实宿主/账号已认证。

## 2. 当前产品边界

顶级产品 surface 固定为 **Canvas | Table | Agent**：

- **Canvas**：空间化 Workflow，用户与 Agent 操作同一份可见生产状态。
- **Table**：结构化媒体处理，不是第二份 Workflow authority。
- **Agent**：本地/外部 Coding Agent 的发现、准备、状态与切换中心。
- **Assistant / Context / History**：只在 Canvas/Table 的 contextual drawer 中，不复制到 Agent 页。

不要重新引入 Agent full-page chat、Tasks/Artifacts/Context 工作区、Production Crew / Director / Operator 必经层、Production Skill Marketplace 或第二套 Canvas/Workflow。

外部 Agent 默认走 **Skill + CLI**；MCP 是同一 operation contract 的可选投影。内置 Assistant、宿主面板和外部 Agent 必须复用同一业务能力与权限边界。

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
→ Workflow / Table / Host consumer
```

素材需要稳定来源、版本与校验信息；临时 URL、聊天消息、base64 不能冒充 durable artifact。晚到任务不能覆盖用户已选择的新版本。

## 5. Creative host / native effect 规则

宿主扩展只是 projection，不建立第二套 Workflow、Provider、任务或资产系统。共同产品边界以主设计 §3 / §5.3 为准；Resolve 实现还必须遵循 `integrations/studio/resolve/PRODUCT_UI_SPEC.md`。

共同硬边界：

- **宿主轻面板**负责当前 selection → intent/reference → plan → generate → import；复杂编排打开 Iris Canvas。
- **native effect / OFX**负责宿主参数、关键帧、固定版本预览与导出；render callback 不联网、不等待模型、不依赖 Agent/Iris 在线。
- 面板/Effect 默认新增结果，不静默覆盖当前素材；替换必须显式且可恢复。
- UI 跟随宿主主题、密度、键盘/焦点和尺寸约束，不把完整 Web Canvas 缩进窄面板。

Host-specific：

- **DaVinci Resolve Studio 21.1 first**：Agent 宿主操作优先使用 Blackmagic native MCP；Iris Skill + legacy `flovart` CLI 提供生成与 Artifact。现有 Workflow Integration 只做轻面板 / fallback adapter，OFX 后置。不要创建第二套 Resolve MCP，也不要为每个 Scripting API 建 Flovart wrapper。
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
- Resolve 外部 Agent 的聊天保留在 Codex/Claude 等原宿主；Iris panel 只显示 context / plan / task / candidate / confirmation。

## 7. 代码边界

- Web：React + TypeScript + Vite + Ant Design + Tailwind + Zustand，以 lockfile 为准。
- 网站后端：Go + Gin + GORM，沿用现有 handler/service/repository/model 分工。
- Local Runtime：Rust/Tauri；CLI/Agent：Node。不要为原生效果复制第二套调度器。
- Workflow：`components/workflow/`、`stores/workflow/`；Table：`components/table/`；Agent：`components/agent/`；宿主：`integrations/studio/`。
- 浏览器业务数据用 localforage；localStorage 只放极小配置。宿主长期素材必须是 durable file/artifact。
- 新增数据表同步 `docs/content/docs/backend/backend-database.mdx`，不要用未来字段冒充已建表。

## 8. 验证与发布口径

- 测试匹配改动风险：文档跑 docs/link checks；代码跑相关测试；宿主/原生效果进真实应用。
- 真实支持状态只由 `SUPPORT_MATRIX.md` 升级；旧 RC 数字、旧截图和旧 build 不能证明当前版本。
- Provider 认证需区分 Fake fixture 与真实账号、扣费、429、取消和 unknown-submit。
- 不宣传未验证的实时生成、宿主 Stable 支持、完全离线、云同步、无缝 Agent 登录态迁移或跨平台等价性。
- 浏览器验收使用仓库规定的 Chrome for Testing / 动态隔离端口；临时测试文件放项目 `.tmp/` 或 `artifacts/`。

## 9. 文档治理

`docs/index.md` 定义 current truth。原则：

- 主设计只保留一个；不要新增并列 CURRENT / TARGET / AUDIT / GOAL / HANDOFF 决策文档。
- 产品设计变化直接更新主设计；Agent 专项更新 `agent-integration.md`；布局更新 `adaptive-layout.md`。
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
