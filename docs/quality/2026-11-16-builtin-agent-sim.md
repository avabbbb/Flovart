# 2026-11-16 内置 Agent 面板模拟用户实测（本地 main 构建 + Command Code 文本 + RunningHub 出图）

> 实测记录。执行时间 2026-11-16 13:17–13:56（UTC+8）。全程只通过画布右侧的内置 Agent 对话面板操作（像用户一样打字、拖图、点确认），不走 CLI。

## 1. 结论（先看这里）

| 场景 | 结果 | 关键耗时 |
|---|---|---|
| A 拖参考图进 Agent 输入框 → 「生成 2 张同风格空会议室」 | ❌ **原样流程失败**；⚠️ 改走「用户先手动建节点」后**出图成功** | 原样：附件直接让文本模型报错；改用画布参考后，Agent 建节点 **2/2 次让画布白屏崩溃**。绕行：从发送到出图约 7 分钟（含人工确认和 1 次 1K 尺寸失败） |
| B 运行中插话「改成 16:9」+ 停止 | ✅ **通过** | 插话 1.5 s 内显示「已加入当前任务，下一步生效」，下一步就带上 16:9；按停止后 2.5 s 内显示 **「已中止」**，没有出现 `signal is aborted without reason` |
| C 同一节点跑 4 张 → 刷新 → 展开叠放 | ✅ **通过**（验证 d6aa722） | 发送到费用确认 6.2 s；确认到 4 张完成 112 s；刷新后 4 张都能显示（2048×1152），没有「媒体文件不存在」 |
| D Agent 改名，同时拖另一个节点 | ✅ **通过**（验证 7e3513a） | 改名一轮 3–14 s。第 1 次撞到真冲突（目标节点本身变了），Agent 重读后自己重试成功；第 3 次期间版本 18→20，**一次就成功**，没有被 REVISION_CONFLICT 拦下 |

- **花费：RunningHub 0.66 元**（6 张 × 0.11，低于 1 元上限）。1K 尺寸那次被 RunningHub 参数校验拒绝（1007），按惯例不扣费，没有计入。已记入 `.tmp/eval/cost.jsonl`（step 以 `sim` 开头）。
- **LLM 请求数**：应用内共 51 次 chat/completions：inkling-2-small 41 次、glyph-cluster 6 次、CPA 4 次（都失败）。另外用 curl 排查了约 5 次 Command Code、约 8 次 CPA。Command Code 免费额度（约 100 次/天）用了约一半。
- **最严重的问题**：Agent 用 `create_connected_node` 建了一个**没有 id 的节点**，左侧图层面板因此崩溃白屏。坏数据已经写进本地存储，**刷新后整个 Workflow 一直停在「正在加载 Workflow...」，所有工作流都打不开**。2/2 次稳定复现，详见第 5 节 P0-1。

## 2. 环境与配置

- **被测版本**：托管站 https://iris.avabbbb.com 的主包 `index-jcBS0Wuo.js`。把它和所有按需加载的分包下载下来搜索，都找不到 d3c51b9 新加的中止文案正则（`signal is aborted without reason` 等），说明 **CF 还没部署今天的提交**。所以改为在 main 上 `vite build` + `vite preview --port 5199`，测试地址是 `http://127.0.0.1:5199/#/app`（HEAD 是 d6aa722，工作区除一个 tauri schema 外没有改动）。
- **浏览器**：复制了一份 `.tmp/eval/sim-session-browser.mjs`，和原脚本相比只改了帧目录（改为 `frames-sim/`）。用 Remotion headless_shell 启动，参数 `--auto-approve --disable-web-security`，`IRIS_WEB_DISCOVERY=/tmp/web-preview.json`。
- **CJK 字体**：把 `/workspace/.fonts/NotoSansCJK-Regular.ttc` 复制到 `~/.fonts/` 并执行 `fc-cache -f`，然后重启了 session browser。中文显示正常（见各截图），只剩 🔑 这类 emoji 还是方块（没有 emoji 字体）。
- **文本线路（按用户要求换线，有两次回退）**：
  1. **CPA**（`https://api.avabbbb.com/v1`，模型 `devin/swe-2-flash`，思考强度「中」，Key 栏填占位符 `CPA_API_KEY`）。13:22 用 curl 流式测试是通的：首包 1.39 s，首个正文 1.60 s，delta 里有 `reasoning_content`，CORS 也放行 `*`。但 13:25 起应用内第 1 次请求等了 7.2 s 后返回 **502**，之后全部是 **403 `public_model_policy`「Select an explicit model from the public model catalog」**。同时 `/v1/models` 只剩一个模型 `hark`，用 curl 去掉 tools 和 system 后同样 403。所以是 **CPA 端在 13:22–13:25 之间把这个模型下线了**，不是 Iris 的问题。因为没拿到过一次 200，**应用怎么处理 `reasoning_content` 以及「content:null + tool_calls」的响应，在 CPA 上没测到**（Command Code 线路上的思考内容显示正常，见下）。
  2. 回退到 **Command Code `stealth/glyph-cluster:free`**：模型不支持图片输入（400），并且**每个工具参数里的字符串都被多包了一层引号**（`"nodeIds":["\"abc123\""]`）。我用最小 curl 请求复现了，是**服务商 / 模型的问题**。结果 Agent 的 `workflow_apply` 被 schema 拒了 2 次，`media_view` 也报「节点不存在」。
  3. 最终使用 **Command Code `thinkingmachines/inkling-2-small:free`**（同一个服务，同一个占位 Key `CMD_API_KEY`）。curl 测试参数干净；应用里思考块显示为「已思考 Ns」，可以展开看思考内容，说明这条线路的 reasoning 字段解析正常。
  - 设置路径：设置 → AI 服务 → + 添加 AI 服务 → OpenAI 兼容 → 取消勾选「图像」→ 填模型 → 验证并保存（2.4–2.5 s）；然后 模型映射 → 文本与 Agent → Agent 文本 → 选主线路。面板里「思考强度」选「中」，请求体里确实带了 `reasoning_effort:"medium"`。
- **图片线路**：RunningHub CN（native，`https://www.runninghub.cn/openapi/v2`），手动加了 `seedream-v5-flash/text-to-image` 和 `/image-to-image`。验证并保存用了 13.7 s。映射里 Seedream 5.0 Flash 有 2 条线路。
- **参考图**：用户上传的会场照片 `094909caa2…-85c380423571.webp`（1080×1440）。

## 3. 各场景过程

### A. 拖参考图进 Agent 输入框，生成 2 张同风格空会议室（❌ 原样失败，⚠️ 绕行后成功）

| 步骤 | 线路 | 耗时 | 结果 |
|---|---|---|---|
| A1 把图拖进 Agent 输入框 | — | <1 s | ⚠️ 只变成对话附件，**没有上画布**（和上午一样） |
| A2 带附件发送 | CPA | 7.2 s 后 502，再 3.5 s 后 403 | ❌ 面板提示「当前 API Key 没有执行此任务的权限」，**掩盖了服务商的真实原因**（模型已下线） |
| A6 带附件发送 | glyph | 1.6 s | ❌ 服务商返回「This model does not support image or file input」，面板提示「当前 AI 服务不接受这组生成参数，请检查模型和参考素材」。附件被当成图片内容直接发给了纯文本模型，没有降级成「放到画布上作为参考」 |
| A4 把图拖到画布空白处 | — | 几秒 | ✅ 生成「图片 1」节点（rev 1→4） |
| A7 「用画布上的『图片 1』做风格参考…」 | glyph | 5 次请求，68 s | ❌ 每个字符串参数都被多包一层引号，apply 校验失败 2 次，最后 Agent 列出方案、反问用户 |
| A8 同上 | inkling | 4 次请求，15 s | ❌ **画布白屏崩溃**（P0-1） |
| A12 修复存储后重试 | inkling | 5 次请求，17 s | ❌ **同样崩溃**。已重试 2 次，按规则停止原流程 |
| A13 绕行：用户在「图片 1」右侧手动拉出「图片生成」节点（拖 + 号，回车），再让 Agent「设成 Seedream 5.0 Flash 图生图，2 张，设置好就运行」 | inkling | 7 次请求，21 s 到达费用确认卡 | ⚠️ 确认卡显示「Workflow 图片生成仅支持平台预设产品模型，请重新选择模型」：Agent 写的 modelId 是 `seedream-5.0-flash`（自己编的） |
| A14 点「拒绝」，回复「请重新选平台预设的 Seedream 5.0 Flash」 | inkling | 约 34 s | ⚠️ Agent 用表单反问，给的 3 个选项全是编的 id（`doubao-seedream-5-0-flash` 等） |
| A15 在表单里选「其他」，填 `flovart:seedream-5-flash` | inkling | 约 37 s | ✅ 到达确认卡，提示「2 个任务 · 预估额度未知」 |
| A16 本次允许 | RH | 34 s | ❌ RunningHub 1007：「image area is too small, minimum 921600」，原因是 1K + 16:9 只有 1024×576（P1-4）。**Agent 自己把分辨率改到 2K**，再次请求确认 |
| A17 本次允许 | RH | 66 s（2 张串行，每张约 16 s 加轮询） | ✅ 2 张 2048×1152，主屏「筑牢AI安全防线」文字正确，风格（红椅、深蓝桌布、蓝色桌牌）和参考图一致。但 Agent 回报「实际费用约 ¥0.11」，**少报了一半**（实际 2 × 0.11） |

画面质量：标题字 2/2 正确，4 张批次的「守护智能未来」也 4/4 正确。问题是**参考图里的人名桌牌「吴梅飞」被原样复制进了"空会议室"**（第 4 张变成「守梅飞」）。另外 Agent 写的提示词里说了"室内无人"，但没有要求去掉桌牌。

### B. 运行中插话 + 停止（✅）

- 发出 A13 的需求 6 s 后（Agent 正在读画布），在同一个输入框输入「改成 16:9」并回车。1.5 s 内出现系统消息 **「已加入当前任务，下一步生效」**，紧接着的 apply 就写入了 `aspectRatio:"16:9"`，确认卡上也是「1K · 16:9 · 2 个任务」。对比上一轮必须先停止再重发，这次插话体验很顺。
- 另外一轮（「看看生成结果，给我写三条建议」）在发送 3.6 s 后点「停止」：2.5 s 内显示中性的 **「已中止」**，没有红色错误卡，也没有 `signal is aborted without reason`。
- 小问题：下一轮对话里，Agent 把被中止的那条请求也一并做了（在 C 的回复末尾补上了"三条建议"）。中止后的请求是否还要继续，应该先问用户（P3）。

### C. 同一节点 4 张 → 刷新 → 叠放（✅）

- 「在『图片生成』节点上再跑一批：张数改成 4，主屏改成『守护智能未来』」→ **6.2 s** 出现确认卡（4 个任务）→ 允许 → **111.7 s** 完成。
- 4 张是**串行**提交的，每张都重新上传同样的 2 张参考图（共 8 次 upload）。单张约 16 s，4 张总共约 69 s，加上 LLM 收尾（P2-3）。
- 刷新页面（6.9 s 挂载完成）→ 点「4张」角标展开 → 4 张都显示了，`naturalWidth` 全部是 2048，**没有「媒体文件不存在」**，d6aa722 修复有效。点「设为首图」切换正常。
- 观察到：重跑后图层里多了一个隐藏的旧版「图片生成」节点，新节点的 PromptBar 显示 2 张画布参考（1、2），所以每个任务上传 2 张参考图。旧结果是不是被当成了参考，还需要开发确认（P2-4，待确认）。

### D. Agent 改名 + 同时拖动另一个节点（✅）

| 轮次 | 拖动期间版本变化 | 结果 |
|---|---|---|
| D1 「图片生成」→「空会场-守护智能未来」 | 14→16（之前点过「设为首图」，目标节点本身变了，再加上拖动「图片 1」） | 第 1 次 apply 返回「Workflow 草稿版本已变化：期望 14，当前 16。期间改动：节点 …」，错误里**列出了改动的节点**。Agent 重新读取后，第 2 次成功（13.7 s，含拖动脚本的时间） |
| D2 →「空会场-v2」 | 拖动没生效（坐标偏了） | 一次成功，不计入结论 |
| D3 →「空会场-守护智能未来」 | **18→20**（拖动「图片 1」，x 92→-28） | **一次 apply 就成功**，2 次 LLM 请求约 3.5 s。Agent 还提示「版本从 18 跳到 20，但改名已成功」 |

结论：不相干的并发拖动**不会再被 REVISION_CONFLICT 拦住**（7e3513a 按节点 rebase 有效）。目标节点自己被改过时仍然会冲突，但错误信息可以读懂，Agent 能自己恢复。

## 4. 响应速度（TTFT 体感）

- inkling-2-small：45 次 200 响应，**响应头中位数 1.8 s**（最大 11 s），**单次请求完成中位数 3.4 s**（最大 16.9 s）。发送后 0 s 就出现「正在思考…」并开始计时；纯操作（改名、改参数）的一轮通常 3–6 s，感觉"跟手"。慢主要慢在 Agent 走多步：先读画布、再看画面、再改、再读一遍，每步 2–3 s。
- glyph-cluster：每步完成 10–16 s，一轮 68 s，而且做不成事。
- CPA：curl 流式首包 1.4 s（模型下线前）。应用里第 1 次 7.2 s 后 502，之后的 403 在 1–3.5 s 内返回。
- 出图：Seedream 5 Flash 2K 每张约 16 s（提交到出结果），多张串行。

## 5. Bug 清单（按严重度）

| 级别 | 问题 | 复现 / 证据 | 状态（2026-11-16 修复后） |
|---|---|---|---|
| **P0-1** | **Agent 建出无 id 节点 → 白屏 → 刷新后整个 Workflow 永远加载不出来**。`iris_workflow_apply` 收到 `create_connected_node` 且 `node` 不带 `id`（inkling 给的是 `{type:"config", title, position, metadata}`）时，`components/workflow/ops.ts:234` 的 `normalizeDocumentNode` 不会生成 id，于是写入了一个 id 为 undefined 的节点，以及一条 `toNodeId` 为 undefined 的连线。`WorkflowSidebar.tsx:235` 的 `dropHint?.id === node.id`（两边都是 undefined）随后去读 `null.zone` → React 崩溃。坏数据已经持久化，刷新时 `migrations.ts:39 nodeOf` 抛「节点缺少 id」→ zustand merge 失败 → `hydrated` 永远是 false →「正在加载 Workflow...」，工作流菜单显示「还没有工作流」，**用户所有工作流都打不开** | 2/2 次稳定复现（A8、A12）。原始坏数据：`.tmp/eval/sim-bricked-project.json`；截图 `sim-A8-state.png`、`sim-A9-after-reload.png`；控制台 `sim-console.log`。建议：apply 时缺 id 就生成 id，或者在 schema 里设为必填；ops 层拒绝 `toNodeId` 为空的连线；Sidebar 改成 `dropHint && dropHint.id === node.id`；水合时跳过坏节点，不要让整个 store 失败 | ✅ 已修复：apply 缺 id 时系统生成、缺 type 报错；ops 不留悬空连线；水合补修复 id、坏项目单独隔离；Sidebar 判空 |
| **P1-1** | Agent 不知道产品模型 id：写入 `modelId:"seedream-5.0-flash"`，apply 不校验就接受了，要到确认卡才报「仅支持平台预设产品模型」。追问时 Agent 给的选项全是编的，用户只能自己填 `flovart:seedream-5-flash` | A13–A15，截图 `sim-B4-confirm.png`、`sim-B5-ask-model.png`。建议：系统提示或 inspect 里给出当前可用的产品模型 id；apply 时校验 modelId | ✅ 已修复：inspect 返回 availableModels（标出已配线路）；apply 把别名归一成规范 id，编造的 id 直接拒绝并列出可用 id；系统提示说明 |
| **P1-2** | 拖进 Agent 输入框的图只作为图片内容发给文本模型：遇到纯文本模型直接 400，也不会放到画布上 | A1/A6，`sim-A1-drop-input.png`、`sim-A6-error.png`。建议：拖入的图同时建成画布图片节点；模型不支持图片时降级为引用节点 id | ✅ 已修复：拖进输入框的图先建成画布图片节点并作为 @节点 引用；服务商拒收图片时记住该线路为纯文本，去掉图片重试一次 |
| **P1-3** | 服务商错误被泛化成误导性的文案：403 `public_model_policy`（模型已下线）显示成「当前 API Key 没有执行此任务的权限」；「模型不支持图片输入」显示成「不接受这组生成参数」 | `sim-errbodies.log`、`sim-A3-error.png`。建议：在错误卡里附上服务商原文 | ✅ 已修复：模型下线 / 不在目录、不支持图片输入有单独文案，不再显示成 Key 权限或参数错误；生成结果被清理时提示「重新生成」而非「重新选择文件」 |
| **P1-4** | Seedream 5 Flash 选 1K + 16:9 会算成 1024×576，低于 RunningHub 要求的最小面积 921600，必然 1007。新建图片节点默认就是 1K | A16。`runningHubRouteCatalog.ts` 里只写了 `minimum: 240`；建议把最小面积写进线路定义，或者 1K 时至少用 1280×720 | ✅ 已修复：Seedream 5 Flash 线路最小面积 921600，按比例放大（1K + 16:9 → 1280×720） |
| **P2-1** | Agent 回报的费用不对（2 张、4 张都说「约 ¥0.11」）；确认卡「预估额度未知」，而 PromptBar 显示 ¥0.110（单张价） | A17、C | ✅ 已修复：一次运行多张时节点上的预估 / 实际费用为整批合计 |
| **P2-2** | 确认卡文案缺数字：「本次对话最多自动运行个任务」 | `sim-B6-confirm2.png` | ➖ 不是 bug：数字在输入框里（可编辑），实测脚本按文本抓取读不到 input 的值 |
| **P2-3** | 多张图串行提交，而且每个任务都重复上传同样的参考图（4 张 = 8 次 upload，约 69 s） | `sim-net.jsonl` | ⏳ 未处理 |
| **P2-4** | 重跑后多出一个隐藏的旧版节点，新节点显示 2 张画布参考（待确认是否把旧结果当成了参考） | `sim-C2-done.png` | ⏳ 待确认 |
| **P2-5** | 图生图照搬了参考图里可读的人名桌牌（「吴梅飞」），这是隐私风险；Agent 写提示词时没有主动要求去掉桌牌、名字 | 结果图、`sim-C4-stack-open.png` | ⏳ 未处理（提示词层面） |
| **P3** | 被中止的请求在下一轮被 Agent 顺手执行了；刷新后，被拒绝的运行显示为「执行失败」（刷新前是「用户拒绝了该操作」）；运行后节点标题被改回「图片生成」（上午已记录，仍然存在）；emoji 显示方块 | — | ⏳ 未处理 |
| 服务商 | glyph-cluster:free 工具参数里的字符串被多包一层引号；CPA 的 `devin/swe-2-flash` 在 13:22–13:25 之间下线（`/v1/models` 只剩 `hark`） | curl 复现脚本：`/tmp/cmd_stream.py`、`/tmp/cpa_stream.py`（临时文件） | ➖ 服务商问题，非 Iris |

同批顺带修复（实测中 Agent 绕路时暴露）：

- **P1-5** `media_view` 传多结果第 2–N 张的备选 id 报「节点不存在」→ ✅ 按备选 id 解析到首图节点上的备选；inspect 摘要和节点详情带 `alternateIds`。
- **P1-6** `ungroup_nodes` 拆不开多结果叠放 → ✅ 传首图节点 id 拆出全部备选、传备选 id 只拆这几张，拆出的节点排在首图右侧并沿用备选 id。

## 6. 和上午 CLI 回退那轮对比

| | 上午（会议室实测，托管站，旧版） | 本轮（内置 Agent，main 本地构建） |
|---|---|---|
| Agent 面板能不能用 | ❌ 只配 RH 时直接报"需要协作方" | ✅ 配好文本线路后能读画布、改参数、运行、插话、停止、改名 |
| 一句话出图 | 0/2（首页、Agent 都失败），全靠 CLI 7/7 | 原样 0/3（附件 400；建节点 2 次白屏）。用户手动建节点、补模型 id 后出图成功 |
| 并发改动 | REVISION_CONFLICT 直接拒，`retryable:false` | 不相干的拖动不再冲突；真冲突有可读的说明，Agent 能自己恢复 |
| 多张叠放 | 未测 | 4 张刷新后都在 |
| 花费 | 0.77 元（7 张） | 0.66 元（6 张） |
| 人工介入 | 全程写 CLI | 手动建 1 个节点、填 1 次模型 id、点 3 次确认、修复 1 次本地存储（测试方修的，真实用户做不到） |

总体：插话、中止、叠放、按节点 rebase 这几项修复在真实面板里都生效了，体验明显比上午好。但「Agent 自己建节点」这条主路径会把整个工作区弄坏，必须先修 P0-1；P1-1（模型 id）和 P1-2（输入框拖图）不修，用户依然没法"拖一张图、说一句话"就出图。

## 7. 产物路径

- 报告：`docs/quality/2026-11-16-builtin-agent-sim.md`（本文件）
- GIF：`.tmp/eval/video/sim-demo.gif`（12 帧 × 1.25 s ≈ 15 s，960 px，带中文字幕）
- 关键截图（`.tmp/eval/shots/`）：
  - `sim-04-cpa-saved.png`、`sim-09-agenttext-bound.png`、`sim-13-route-inkling.png`：服务与线路配置
  - `sim-A1-drop-input.png`：输入框拖图只变成附件
  - `sim-A6-error.png`、`sim-A3-error.png`：附件 400 / CPA 403 的文案
  - `sim-A7-agent-fail.png`：glyph 参数被多包引号
  - `sim-A8-state.png`、`sim-A9-after-reload.png`：**白屏崩溃、刷新后加载不出来**
  - `sim-B3-steer.png`：插话「已加入当前任务」
  - `sim-B4-confirm.png`、`sim-B5-ask-model.png`、`sim-B6-confirm2.png`：模型 id 问题、确认卡
  - `sim-A18-result.png`：2 张出图
  - `sim-B8-stopped.png`：「已中止」
  - `sim-C4-stack-open.png`：刷新后 4 张叠放
  - `sim-D1-rename.png`、`sim-D3-rename.png`：并发改名
- 数据：`.tmp/eval/sim-timeline.jsonl`（步骤时间）、`sim-net.jsonl`（每个 LLM 和 RH 请求的响应头、完成耗时）、`sim-panel.jsonl`（面板文本变化）、`sim-errbodies.log`、`sim-console.log`、`sim-bricked-project.json`、`cost.jsonl`
- 帧：`.tmp/eval/frames-sim/`（每秒 1 帧，约 2000 张）

## 8. 说明

- 测试中为了继续后面的场景，**两次手动修复了 IndexedDB**（删掉无 id 节点和悬空连线）。真实用户没有这个手段。
- 运行中的进程：`vite preview --port 5199`、`sim-session-browser.mjs --auto-approve`（已替换上午的 session browser）、原来的 agent(17373) 和 vite dev(37522) 没动。`dist/` 是这次构建的产物（已被 git 忽略）。
- 实测时没有提交代码；本文后来随修复一起提交（第 5 节状态列）。没有在本文写入任何 Key。
