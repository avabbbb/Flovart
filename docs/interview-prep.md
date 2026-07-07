# Flovart 面试笔记 — Agent 工程化实践

> 项目背景:Flovart 是一个 AI 画布工作站(Web + 桌面 + 企业后台),让用户在无限画布上生成图/视频、编排 Workflow、管理素材。
> 技术栈:Next.js App Router + React 19 + TypeScript + Ant Design + Tailwind + Zustand + Konva/SVG 画布 + Go(Gin/GORM)后端 + Tauri 桌面端。
> 规模:169 个 commit、69 个测试文件、385 个测试用例、~182 个源码文件、38 个第三方模型端点(5 图 + 33 视频)。
> AI 协作:全程用 opencode(Claude/GLM 系)作为结对 agent,人写决策,agent 写实现,人审代码。
> 整理时间:2026-07-07,用于面试分享"我们如何用 agent 做一个真实产品"。

---

## 核心立场(一句话)

> **Agent 不是不能用,是不能信任。** 我们用三层纪律驯服它 — 数据化 capability 矩阵防幻觉,CLI/MCP 协议边界防越权,AGENTS.md + 测试前门防失忆和回归。

---

## 难题 1:AI 幻觉 vs 真实 API 字段映射 — 38 端点逐字段对照

### Situation(情境)
- 我们接入 RunningHub 作为视频/图片生成聚合层,38 个端点字段差异极细,且官方文档分散在 8 份独立 PDF/网页里。
- 关键差异举例:
  - **Veo 3.1 Lite official i2v** 用 `imageUrl`(单数),其他所有 i2v 用 `urls`(数组)
  - **Seedance 2.0** 必须带 `generateAudio: true`,而 **Veo 3.1 start-end lite** 要同时删 `duration` 和 `generateAudio`
  - **Veo 3.1 pro-official ref** 要删 `aspectRatio`,但 **fast-official ref** 要保留 `aspectRatio`
  - i2v/ref 最多 3 张参考图,Seedance 图最多 9 张 / 视频最多 3 段 / 音频最多 3 段
  - duration 选项按模型族不同:Veo 3.1 标准 `[4,6,8]` / 低价+首尾帧 `[8]` / Omni `[3,5,8,10,12,15]` / 全能视频S `[10,15]` / Seedance `[-1,4,5,6,8,10,12,15]`

### Task(任务)
- 让 agent 一次性把这 38 个端点的字段映射全部写对,且后续模型更新时能精确扩展,不能"差不多就行"。
- 一旦字段写错,用户看到的不是"生成失败",而是"参数被静默丢弃,生成出错误结果"——这是最坏的 bug 类别。

### Action(行动)
1. **抓 8 份官方 API 文档逐字段对照**:用 `webfetch` 抓 RunningHub 各端点官方文档,人工 + agent 一起对照每个请求体字段,把差异列成一张矩阵。
2. **把"模型能力"从代码分支抽成数据矩阵**(`services/aiGateway.ts`):
   - `SEEDANCE_CAPABILITY`: `{ image: 9, video: 3, audio: 3, durations: [-1,4,5,6,8,10,12,15] }`
   - `DEFAULT_VIDEO_CAPABILITY`: 通用视频能力,无 durations 字段
   - `resolveRunningHubVideoDurations(model)`:按模型族精确返回 durations,不写"统一默认"
3. **端点识别用正则,不靠字符串相等**:RunningHub 的 Seedance 端点 ID 是 `sparkvideo-2.0` 不含 "seedance",如果用 `normalized.includes('seedance')` 会漏掉所有 RH Seedance 端点——这是真实踩过的坑。改用 `isRunningHubSeedance20Model` 匹配 `sparkvideo|seedance-2.0`。
4. **93 个测试断言每个端点的请求体**:`aiGateway.test.ts` + `aiGatewayValidation.test.ts` 共 74 + 19 = 93 个用例,断言每个端点发出的 fetch body 与官方文档字段名、字段有无、张数上限完全一致。

### Result(结果)
- 38 端点全部通过字段对照,93/93 测试全绿。
- 后续新增端点(Veo 3.1 系列从 0 扩到 13 个)只需:在 `BUILTIN_RUNNINGHUB_MODELS` 加一行 + 在 `resolveRunningHubVideoDurations` 加一个 case + 加一个测试用例,3 处改动即可,不会再出现"字段写错"。
- commit 记录:`1214912`(Veo 3.1 Lite i2v imageUrl 单数修复)、`950985e`(时长 bug 修复)。

### 面试可讲句
> "agent 不是写不出代码,是写得太自信。我们把'模型能力'从 if/else 分支抽成数据矩阵 + 测试断言,让幻觉无所遁形。每个端点的请求体都被 93 个测试盯死,字段名错一个字符就红。"

---

## 难题 2:Agent 捏造 HTTP 请求 — 用 CLI/MCP 强制确定性边界

### Situation
- Flovart 既有 Web UI,也要被外部 agent(Claude Code / Codex CLI / OpenClaw)操作画布。
- 外部 agent 的典型"越权幻觉"行为:
  - 自己编 HTTP 请求(猜 endpoint 路径、猜 body 结构)
  - 抓 UI DOM 找按钮然后 click(脆弱、慢、易错)
  - 在生成代码里硬编码 API key(安全事故)
- 这些行为在 demo 里看着能跑,放进真实工程就是定时炸弹。

### Task
- 给外部 agent 一个**确定性边界**:agent 只能"规划",执行必须走我们提供的协议入口。
- 不能依赖 agent 自觉,必须在协议层硬性约束。

### Action
1. **造 Flovart CLI**(`tools/flovart/cli.js`,7172 字节入口 + `core.js` 52181 字节命令注册表):
   - 所有画布/媒体/workflow/provider/asset/project 操作走 `npm run flovart:cli -- <command> --json`
   - 命令注册表 `COMMAND_REGISTRY` 是唯一真相源
   - `command.list` / `command.schema` 自描述,agent 可以运行时查询
2. **同时 ship MCP server**(`tools/flovart/mcp-server.js`):
   - 把 CLI 所有命令包装成 MCP tools,通过 stdio 协议暴露
   - 用 `@modelcontextprotocol/sdk` + zod schema 自动校验参数
   - Claude Code / Codex 直接 connect 即可,无需猜 HTTP
3. **Shadow Runtime**(`tools/flovart/shadow-runtime.js`,32803 字节):
   - 离线状态机,记录 selectedElementIds / zoom / panOffset / elements / projects / workflowProjects / jobs / provider
   - 状态文件落在 `%LOCALAPPDATA%/Flovart/shadow-runtime-state.json`
   - agent 可以在不开浏览器的情况下规划画布操作
4. **Skill description 硬性写禁令**(`.agents/skills/flovart/SKILL.md`):
   > "External agents plan; Flovart CLI executes explicit commands. **Do not invent HTTP calls, scrape the UI, or expose API keys.**"
   - 这条 description 会被 agent 当作系统指令读进去
   - 还写: "If this skill disagrees with `command.list` or `command.schema`, trust the CLI output and update the skill docs." —— 让 CLI 永远是真相源

### Result
- 外部 agent 接入 Flovart 只需 `npm run flovart:mcp`,不再需要看我们的 React 代码或猜 API。
- 后续要加新能力,只在 `COMMAND_REGISTRY` 注册一个命令 + 自动暴露成 MCP tool,agent 立即可用。
- 这套架构也被 opencode-skill-creator 体系复用,我们内部 `flovart` skill 就是这个模式的范本。

### 面试可讲句
> "我们没有让 agent 直接操作应用,而是造了一个确定性 CLI + MCP 层。agent 负责规划,CLI 负责执行。这把 agent 的不可控性关进了协议笼子,也把'怎么操作 Flovart'从隐式知识变成了显式协议。"

---

## 难题 3:缓存层吞噬真相 — modelFetcher cache hit 丢端点

### Situation
- 模型列表加载流程:`fetchModelsWithCache` → cache hit 直接返回 → `fetchRunningHubModels`(远程拉)→ `mergeModelLists` → `mergeFetchedModelsIntoKey` → 写入 `key.models` → UI 渲染下拉。
- 内置端点表 `BUILTIN_RUNNINGHUB_MODELS`(38 个)是静态的,会随版本更新扩充。
- **Bug**: cache hit 时直接 return cache,跳过了 `BUILTIN_RUNNINGHUB_MODELS` 的 merge。结果:用户第二次打开应用,内置 38 个 RunningHub 端点全部消失,只剩远程拉到的部分模型。
- 用户反馈:"我昨天还能选 Veo 3.1,今天怎么没了?"

### Task
- 修这个 bug,但不能"为了修 bug 写复杂逻辑"。
- 不能要求用户清缓存,因为本地存储是业务数据(画布、素材),清掉会丢用户作品。

### Action
1. **画数据流定位根因**:审计 `fetchModelsWithCache` → 发现 cache hit 分支以为 cache 已经完整,不知道内置表会随版本扩充。
2. **一行 merge 修复**(`services/modelFetcher.ts`):cache hit 时,对 `runningHub` provider 仍然重新 merge 最新的 `BUILTIN_RUNNINGHUB_MODELS`。
   - 不写"如果 cache 过期就重新拉"——内置表是静态的,merge 成本可忽略,每次 merge 比写过期判断更简单可靠。
3. **加回归测试**(`tests/baseUrlPassthrough.test.ts`):断言 cache hit 路径仍然包含内置端点。
4. **同步修 `mergeFetchedModelsIntoKey` 丢 description 的问题**:它只保留 modelId,丢弃 `BUILTIN_RUNNINGHUB_MODELS[].description`(如 "Seedance 2.0 文生视频"),导致搜索 "seedance" 找不到模型——根因同源,一起修。

### Result
- 38 端点在任何缓存状态下都完整可见。
- 后续新增内置端点,无需担心"老用户 cache 里没有"。
- commit 记录:`1214912`(本次修复含 cache hit merge)。

### 面试可讲句
> "缓存不是 set-and-forget。我们审计出 cache hit 路径会绕过内置模型表,根因是缓存层承担了它不该承担的'数据完整性'职责。修复只用一行 merge,但发现它需要画数据流。这教会我:每一层只做一件事,缓存层不要替数据源做完整性判断。"

---

## 难题 4:Agent 长会话失忆 — 用 AGENTS.md 沉淀决策

### Situation
- 一个长会话里 agent 会忘记关键决策,典型翻车:
  - 我们决定"生成结果原节点直接成为媒体节点(count=1 时),不新建节点",但 agent 后面又写出了"总是新建 batched 节点"的代码,导致用户看到画布上多出一个意外节点。
  - 决定"生成中状态显示在发起节点本身",agent 改着改着变成"新建 loading 节点"。
  - 决定"localforage 存业务数据,localStorage 只存极小配置",agent 在新功能里又用 localStorage 存了 200KB 的生成记录,触发配额报错。
- agent 没有"肌肉记忆",每次新会话都是从零开始,只看当前文件。

### Task
- 让关键决策在跨会话、跨 agent 实例之间稳定传递。
- 不能靠"每次 prompt 里重复说一遍",那会污染上下文且不可持续。

### Action
1. **建立 `AGENTS.md` 作为项目宪法**:
   - "角色设定"章:定义 agent 人格(Dario 严苛总监)和必读义务
   - "基本原则"章:6 条硬规则(先读再改、最少行数、不兼容旧数据、不改无关文件、不回滚用户改动)
   - "反复提醒沉淀"章:明确规定"如果用户反复提醒同一注意事项,必须补充到本文件"
   - "后端规范"/"前端规范"/"画布 UI 规范"/"文档规范"/"发版流程"章:把架构边界写死
   - "项目注意事项"章:把踩过的坑写成明确规则(如"当前画布主要保存在浏览器本地,不要在文档中误写成已支持云同步")
2. **优先级规则**:开发时优先遵循 AGENTS.md,其次遵循用户当前消息。这样 agent 不会用"用户没说"来绕过已有规则。
3. **关键决策在对话里反复复述 + handoff 文档传递**:跨会话用 handoff skill 生成上下文摘要,新会话开头先读 handoff + AGENTS.md。
4. **把"反复提醒"机制化**:每次用户纠正 agent 超过 2 次的点,主动追加到 AGENTS.md 对应章节,写成可执行规则而非模糊描述。

### Result
- `AGENTS.md` 从 0 成长到 101 行,覆盖 10 个章节,沉淀了 20+ 条硬规则。
- 跨会话失忆率显著下降:原节点替换、localforage、不兼容旧数据等决策在后续会话稳定执行。
- 这套 AGENTS.md 模式被其他项目复用,成为我们团队 agent 工程化的标准动作。

### 面试可讲句
> "agent 没有'肌肉记忆'。我们把反复出错的模式沉淀进 AGENTS.md,把它变成项目的'宪法'。这比每次 prompt 里重复说一遍效率高一个量级,且让决策从'口头约定'变成'代码可读的规则'。"

---

## 难题 5:双架构回退 — git checkout 选择性恢复,不 reset --hard

### Situation
- 画布从 `5d2fc18` 的 SVG/Konva 版被一次 newer 重构搞坏:ReferenceError(`stageLabelMap` 未定义)、生成中状态崩溃、节点拖动失灵。
- 常规回退做法是 `git reset --hard 5d2fc18`,但用户工作区有未提交改动(企业后台 5 面板修复),reset 会杀掉这些工作。
- agent 默认倾向"回滚到干净状态",因为它不理解"用户的工作"的价值。

### Task
- 外科手术式恢复画布相关文件,保留其他未提交改动。
- 不 rewrite history,要让回退动作本身可追溯。

### Action
1. **用 `git checkout 5d2fc18 -- <具体文件>` 选择性恢复**:
   - 只恢复画布相关文件(`components/canvas/*`、`components/workflow/*`、`styles/workflow.css` 等)
   - 保留企业后台、后端、文档等未提交改动
2. **新建 commit 记录回退**(`6a5d14f`):"refactor: 画布回退到 5d2fc18 SVG/Konva 版 + Agent Chat 接线 + insertBefore 修复",而不是 rewrite history。
3. **后续补漏**(`006ab20`):回退时漏带了 `stageLabelMap` 定义,触发 ReferenceError,单独补一个 fix commit。
4. **把规则写进 AGENTS.md**:"如果工作区已有用户改动,不要回滚,不要覆盖;只在必要范围内追加修改"。

### Result
- 画布恢复稳定,企业后台改动零丢失。
- 回退动作在 git log 里清晰可见,后续可以审计为什么回退。
- 这条规则在后续多次重构里被反复验证,再没出现过"reset 杀掉用户工作"的事故。

### 面试可讲句
> "agent 默认喜欢 reset --hard 追求'干净',但生产里工作区永远有未提交改动。我们建立规则:用 `git checkout <sha> -- <file>` 做外科手术式恢复,永远不 reset。这把'回退'从破坏性操作变成可审计的提交。"

---

## 难题 6:Agent 重构回退已修 bug — 测试 + tsc 作为 commit 前门

### Situation
- 169 个 commit 里多次出现"修过的 bug 又回来了":
  - `c7a37c5` 修了 Ctrl+滚轮 `passive:false`,后面重构又变回 passive,导致画布缩放卡顿
  - `23defea` 修了 React key 重复,后面又复现
  - `stageLabelMap` 在回退时漏带,触发 ReferenceError
  - `useToast` 闪屏修过一次,后面又被改回
- agent 重构时不会主动跑测试,默认"我改的没问题",这是典型的"乐观主义者陷阱"。

### Task
- 防止 agent 重构时静默回退已修 bug。
- 不能靠"agent 自己记得跑测试",必须强制。

### Action
1. **建 69 个测试文件 / 385 个测试用例**:
   - 核心层全绿:`aiGateway` 74/74、`aiGatewayValidation` 19/19、`workflowGeneration` 19/19、`workflowMedia`、`workflowOps`、`baseUrlPassthrough` 等
   - 共 323 passed / 61 failed(全为 pre-existing,显式记账)/ 1 skipped
2. **每次 commit 前必须跑 `npx tsc --noEmit` + 相关 vitest**:在 AGENTS.md 写死"任务完成前必须跑 lint 和 typecheck"。
3. **pre-existing 失败显式记账**:`workflowEditor.test.tsx` 30 个失败、`workflowStore.test.ts` 9 个 hook timeout、`workflowImageTools.test.tsx:81` tsc 错误——这些在 handoff 文档里标为 "Blocked / pre-existing",不让 agent 误以为是自己的回归。
4. **AGENTS.md 里把测试命令显式化**:这样 agent 在任何会话都能查到要跑什么,不会"忘了"。

### Result
- 核心层 93/93 测试成为 commit 前门,任何字段映射回归一眼识别。
- pre-existing 失败被显式隔离,不再干扰回归判断。
- 后续重构时,agent 跑完测试看到 323 绿 + 已知 61 红,能立刻判断"我的改动有没有引入新红"。

### 面试可讲句
> "agent 重构时是'乐观主义者',它不会主动跑测试。我们把 93/93 测试 + tsc clean 作为 commit 前门,并把 pre-existing 失败显式记账,这样真回归一眼能识别。这把'质量保障'从 agent 的自觉变成基础设施的强制。"

---

## 附:可量化的工程数据(面试可背)

| 维度 | 数值 |
|------|------|
| Git commits | 169 |
| 测试文件 | 69 |
| 测试用例 | 385(323 pass / 61 pre-existing fail / 1 skip) |
| 核心层测试 | 93/93 全绿(aiGateway + aiGatewayValidation + workflowGeneration) |
| 源码文件(.ts/.tsx) | ~182 |
| `aiGateway.ts` 行数 | 3135 |
| `runningHubService.ts` 行数 | 899 |
| 第三方模型端点 | 38(5 图 + 33 视频) |
| RunningHub 官方 API 文档 | 8 份(全部逐字段对照) |
| AGENTS.md 规则 | 101 行 / 10 章节 / 20+ 硬规则 |
| 内置 MCP 命令 | 全量 CLI 命令自动暴露 |
| 权限点(企业后台) | 14 个 RBAC 权限 |

---

## 附:6 条一句话总结(面试快问快答备用)

1. **防幻觉**:把模型能力从 if/else 抽成数据矩阵 + 93 测试断言,字段名错一个字符就红。
2. **防越权**:造 CLI + MCP 协议层,agent 只规划不执行,禁止捏造 HTTP / 抓 DOM / 暴露 key。
3. **防缓存吞真相**:cache hit 不替数据源做完整性判断,每次 merge 内置表,一行修复。
4. **防失忆**:AGENTS.md 当项目宪法,反复出错的点沉淀成硬规则,跨会话稳定传递。
5. **防回滚杀工作**:用 `git checkout <sha> -- <file>` 外科手术恢复,永远不 reset --hard。
6. **防回归**:93/93 测试 + tsc 当 commit 前门,pre-existing 失败显式记账,真回归一眼识别。

---

## 附:面试可能追问的延伸问题

- **Q: 为什么不用 Postman/Bruno 集合而是自己造 CLI?**
  A: Postman 是人用的,agent 用不了。CLI + MCP 让 agent 能在协议层直接调用,且 `command.schema` 自描述,agent 可以运行时查询,这是 Postman 做不到的。

- **Q: 93 个测试够吗?为什么不追求 100%?**
  A: 核心层(字段映射 / 生成流程)100% 覆盖,UI 交互层(workflowEditor 30 失败)是 pre-existing,优先级低于核心。我们追求"关键路径 100%",不是"行覆盖率 100%"。

- **Q: AGENTS.md 和 Cursor Rules / Claude Code CLAUDE.md 有什么区别?**
  A: 思路一致,我们的特色是"反复提醒沉淀"机制——用户纠正超 2 次的点必须追加成规则,这让文档自我生长,而不是写完就 frozen。

- **Q: agent 写代码比人快吗?**
  A: 单次输出快,但加上"审计 + 测试 + 回归修复"后,总速度和人接近。真正的好处是:它把"机械实现"外包了,人可以专注在"决策 + 审计"上,这是更高杠杆的事。
