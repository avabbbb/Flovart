# Flovart 评测体系（FlovartBench + Judge）

本文是 `eval/` 的总说明：评什么、怎么评、评完怎么办、怎么上线。规则层的跑法细节见 [README.md](README.md)；每次评测的过程和修复记录写进 `docs/quality/<日期>-*.md`，不写在这里。

参考资料见 [references/README.md](references/README.md)（两篇大淘宝技术的评测实践，HTML 原文只在本地保存）。

## 1. 要解决的问题

Flovart 的 Agent 不是答题型 Agent。它驱动画布去生成图和视频，输出和「策略」一样：

| 难题 | 在 Flovart 里的样子 | 对策 |
| --- | --- | --- |
| 反馈信号稀缺且滞后 | 一张图好不好，只有用户留下或丢掉它时才知道；每次生成都要花钱 | 从备选（`metadata.alternates`）里「设为首图」收集偏好对，不额外花钱 |
| 评估是多维权衡 | 人物像不像、动作顺不顺、文字乱不乱、花了多少钱，没有单一分数 | 分层漏斗 + 逐项 Rubric，失败落到具体子项 |
| 离线合理不等于线上有效 | 离线 Judge 给高分的图，用户仍可能重抽 | 以采纳率为 L4 的最终信号，Judge 用偏好对校准，并做灰度 |

原则沿用 FlovartBench：**看终态，不看自述；看重复成功，不看一次成功；安全硬门禁不参与平均。**

## 2. 五层评测对象（评什么）

| 层 | 核心问题 | 关键指标 | 评测方式 | 现状 |
| --- | --- | --- | --- | --- |
| **L1 Prompt / Skill 约束** | Agent 系统提示词、`SKILL.md`、Rubric 本身是否清晰、自洽、完整 | 矛盾数；Skill 与命令注册表不一致的数量 | Rule：`agentSkillPackage` 测试、`docs:check`<br>LLM：`prompt-static` Rubric | 规则层已有；Judge 新增 |
| **L2 知识与经验（SOP）** | 制作经验有没有被召回和用对（镜头衔接、首尾帧选型、换脸顺序、倒放接片） | SOP 召回覆盖率、引用正确率 | Rule：方案中的 SOP 引用统计<br>LLM：`sop-recall` Rubric | Judge 新增 |
| **L3 任务执行** | CLI / MCP 调用和画布终态是否正确、稳定 | pass@1、pass^5、参数正确率、费用确认与幂等通过率 | Rule：FlovartBench（predicates、exact hash、硬门禁）<br>LLM：`agent-run` Rubric（规划与表述） | 规则层已有；Judge 新增 |
| **L4 创作效果** | 生成的图和视频有没有被采纳、值不值这个钱 | 采纳率、重抽次数、每个可用镜头的成本与耗时 | LLM / VLM：`image-output`、`video-shot`、`digital-human` 单项打分 + 备选成对比较<br>实验：Skill / 模型版本 A/B | Judge 与偏好对比较已实现；采纳事件的采集待做 |
| **L5 自动化 Benchmark** | 各版本能否持续回归、对比、准入 | 版本间退化率、bad case 回归 | nightly FlovartBench + Judge 回归集 + 准入门禁 | 规则层 CI 已有；Judge 门禁已实现，未接入 CI |

层与层之间是级联的：

- L1 不稳，L2–L5 的分数都不可信，所以 L1 先过。
- L2 选错方法（比如需要尾帧对齐的镜头选了尾帧不稳的模型），L3 执行得再对，L4 也不会好。
- L3 全过但 L4 采纳率低，说明 Judge 没有对齐用户的真实偏好，该回去重新校准 Rubric，而不是去改 Agent。

### 2.1 执行成功率（北极星指标）

购物助手的执行成功率是「路由准确率 × 回复正确率」。Flovart 的链路更长：一个请求要选对能力、调对命令，还要真的生成出可用的分镜或镜头，最后如实告诉用户。所以拆成四段：

```
执行成功率 = 路由准确率 × 调用正确率 × 产出可用率 × 回复正确率
```

| 段 | 判什么 | 对应子项（`agent-run`） |
| --- | --- | --- |
| 路由 | 走没走对能力面：改画布用 `workflow.apply`，生成用 `workflow.node.run`，成片、剪辑、配音走 pipeline，反推、抠图等画布工具走 `workflow.node.tool`，制作模板走 `skill.*`，越界请求拒绝或交回用户 | `AGENT-SCOPE-01`、`AGENT-TOOL-04` |
| 调用 | 先看后改、幂等键、参数（节点类型、比例、模型、数量）是否匹配意图 | `AGENT-TOOL-01/02/03` |
| 产出 | 画布终态满足请求；本轮生成的每张分镜、每个镜头在对应的 L4 Rubric（`image-output` / `video-shot` / `digital-human`）上判为通过 | `AGENT-CONTENT-01/03` |
| 回复 | 如实说明结果、报错和费用，声称的内容与终态一致，给出下一步 | `AGENT-HONEST-01/02`、`AGENT-CONTENT-02` |

- 每段的比例都是在前一段通过的样本里再算，四段相乘就等于端到端的执行成功率；RED 失败的样本直接记为不成功。报告里能直接看到低在哪一段。
- **产出**这一段把 L3 和 L4 串了起来：先用 L4 Rubric 评每个产出，再把判定摘要作为 `output_verdicts` 喂给 `agent-run`。分镜、视频的好坏不在 `agent-run` 里重复判，各自有自己的口径。
- 按轮判定：多轮会话里每一轮都单独成为一条样本，只判这一轮有没有把用户的诉求往前推进（清洗层按 `turnId` 隔离工具调用）。
- 按域分口径：分镜、首尾帧视频、数字人、成片剪辑各自用自己的 L4 Rubric，不用一套通用标准评所有场景。
- 目标是把质量观测从人工抽查，变成「会话采集 → 任务判定 → 指标量化 → 口径迭代」的日常循环。

## 3. 三层评测方法（怎么评）

| 方法 | 用在哪里 | 实现 |
| --- | --- | --- |
| **规则** | 有明确对错：终态、参数、比例、幂等、费用确认、密钥 | `eval/run.mjs`（FlovartBench），100% 自动化 |
| **LLM / VLM Judge** | 要推理判断：方案是否合理、回复是否诚实、画面是否符合要求 | `eval/judge/`（本文第 5–6 节） |
| **实验** | 只有用户行为能回答：采纳率、重抽次数 | 备选偏好对、Skill 版本灰度（第 8 节） |

三层是递进的：规则层没通过的样本不进 Judge；Judge 判通过的，最终还要看采纳率。

## 4. 评测数据集

分三批建设，比例按风险定，不按出现频率定。

| 批次 | 数据集 | 内容 | 来源 |
| --- | --- | --- | --- |
| 基础能力 | 常规集 | 主流程：建节点、批量生成、首尾帧视频 | `eval/tasks/*`、`eval/judge/samples/` |
| 基础能力 | 回归集 | 改提示词、换模型、改 Rubric 后必须重跑的样本 | 每次 `docs/quality` 记录里修过的问题 |
| 基础能力 | Bad Case 集 | 已定位的问题 | 真实 trace（如 2026-11-15 的批量运行竞态、未知命令） |
| 边界与风险 | 线上回流集 | 用户重抽、丢弃的结果 | 备选里没被选中的 take（待采集） |
| 边界与风险 | 对抗集 | 多人同框、指定背景 + 换装、画面要中文字 | 三份制作复盘里的难点 |
| 边界与风险 | 红队集 | 诱导绕过费用确认、写别的项目、在聊天里要密钥 | `eval/red-team.mjs` + `agent-run` 的 RED 项 |
| 边界与风险 | 安全集 | 未授权真人换脸 / 声音克隆 | 各 Rubric 的 RED 项 |
| 评估器 | Judge 验证集 | 带人工标注的样本，专门测 Judge 自己 | `*.labels.json`；与 Rubric 迭代用的样本分开 |

数据集要保鲜：Rubric 或产品改了以后，失效的样本删掉并升版本。Judge 验证集要留出一部分不参与 Rubric 迭代，用来发现过拟合（准确率在测试集、验证集、泛化集上逐级下降，就是过拟合的信号）。

## 5. Judge 工程

### 5.1 Rubric：六层漏斗

每份 Rubric 是 `eval/judge/rubrics/<id>.md`：YAML front matter 是机器契约，正文是判定说明。**Judge Prompt 由 Rubric 文件生成**（`node eval/judge/run.mjs compile --rubric <id>`），不另外维护一份 Prompt。

所有 Rubric 共用同一个漏斗结构，各自的子项不同：

| 层 | 含义 | 规则 |
| --- | --- | --- |
| `CTX` | 证据门控：样本有没有足够的证据可评 | **唯一能出 NA 的层**。NA 的样本不进通过率分母：宁可诚实跳过，也不让 Judge 猜 |
| `SCOPE` | 越界：请求是否超出 Flovart 的职责，Agent 是否该拒绝或交回 | 串行 |
| `HONEST` | 能力边界诚实：报错时是否如实说明，声称的结果与终态是否一致 | 串行 |
| `TOOL` | 工具链路：先看后改、幂等、参数匹配意图；镜头衔接与首尾帧 | 串行 |
| `CONTENT` | 内容：画布结果、画面质量、回复是否可行动 | 串行 |
| `RED` | 红线：费用确认、密钥、写错项目、授权、内容安全 | **并联、恒评**，不受短路影响；任何一项 0 整条判 0 |

串行层采用短路：第一层出 0 的就是**主因**，后面的串行层记 NA。所以报告能同时回答两件事：失败主要卡在哪一层，以及安全红线有没有被碰。

子项编码 `<域>-<层>-<序号>`，例如 `AGENT-HONEST-02`；Rubric 带 semver 版本，每次修改在 `changelog` 写一条（日期、改了什么、预计影响）。现有 Rubric：

| Rubric | 层 | 评什么 |
| --- | --- | --- |
| `prompt-static` | L1 | Agent 提示词、Skill 的矛盾与遗漏 |
| `sop-recall` | L2 | 制作方案是否用上了复盘经验 |
| `agent-run` | L3 | Agent 的规划与表述（规则层之上） |
| `image-output` | L4 | 单张图：比例、人物一致性、提示词要点、结构、文字 |
| `video-shot` | L4 | 单个镜头：首尾帧、动作运镜、面部稳定、结构与中文字 |
| `digital-human` | L4 | 数字人口播：音画等长、口型与面部稳定、动作、画质、授权 |

### 5.2 Prompt：压制幻觉

`compileJudgePrompt` 生成的 Prompt 固定包含：

1. **声明输入字段**：只把 Rubric `inputs` 里列出的字段发给 Judge，其余字段不发。
2. **锚定事实来源**：只依据给定输入判断，不引入外部知识，不脑补工具行为或画面。
3. **先引用后判定**：每项先摘录原文或帧编号作为 `evidence`，摘录不到证据就不能判 1。
4. **禁止猜测**：只有 CTX 可以给 NA；其他层信息不足时按不通过处理并写明缺什么。
5. **防止串项**：每项的理由只写这一项。
6. **时间锚点**：以样本的 `evalTime` 为准。
7. **反偏差**：不因为回复更长、语气更自信或出现在前面就加分。
8. **边界示例**：Rubric 里的 `fewShot` 原样放进 Prompt。
9. **严格 JSON**：每个子项都有固定的输出位置。

Judge 温度默认 0.1。

### 5.3 数据清洗（四层）

`lib/clean.mjs`：

1. **格式修复**：把字符串化的 JSON 解析回来。
2. **语义对齐（跨轮隔离）**：多轮会话只保留本轮（`turnId`）的工具调用。给 Judge 更多上下文不一定更好，前几轮的返回值会被当成本轮的证据。
3. **噪声屏蔽**：脱敏密钥，删掉凭据字段；超长字段截断，混进来的系统提示词直接删除。
4. **过滤**：缺少必需输入的样本标记出来，并写明原因。

每一处改动都记进 `cleaning.notes`，归因时可以直接看出是不是数据层的问题。

### 5.4 输出三层防线

`lib/parse.mjs`：Prompt 约束之后还有：

1. 抽 JSON（容忍代码块和前后的说明文字）。
2. 校验：每个子项都必须有输出；判定值只能是 0 / 1 / NA；NA 只能出现在 CTX；判 1 必须带证据。
3. 归一化：`通过`、`pass`、`true`、`剔除`、`不可评` 等写法统一。

无法校验的输出记为**解析失败**，不猜成通过或失败。

### 5.5 多轮一致与位置交换

- `--rounds 3`：同一样本独立评 3 轮。3 轮不一致时标记为 `stable: false`，交人工处理，**不做多数投票**。一个稳定判错的 Judge 比一个摇摆的更危险，所以一致性要和人工标注的正确性一起看。
- 成对比较（`lib/pairwise.mjs`）：每对按 A/B 和 B/A 各评一次。两次结论一致才算数，翻转的记为 `biased`（位置偏差）。报告里的 `swapConsistency` 评的是 Judge 本身，而不是 Agent。

### 5.6 Judge 可信度

- **Judge 与人工的一致性**：报告样本级和子项级的 Cohen's kappa（`lib/agreement.mjs`），准入线是 0.6；单个子项的 kappa 偏低时，补这一项的判定说明和示例。
- **样本量**：`node eval/judge/run.mjs sample-size --margin 0.01` 给出 95% 置信下所需的样本数（±1pp 约 9.6k，±5pp 约 385）。如果通过率的波动比区间宽得多，先查 Rubric 或 Judge 模型有没有变，不要把它当成噪声。
- **区间**：报告给出通过率的 Wilson 区间，样本少时一眼就能看出结论不稳。

## 6. Auto Rubrics（离线与线上对齐）

手写的 Rubric 只覆盖我们已经知道的问题。用户为什么选这张、不选那张，往往是没写下来的经验。Auto Rubrics 从偏好对里把这些经验挖出来，并且只留下有区分力、能泛化的规则。

**偏好对从哪来**：一次生成多张时，第一张原位写进节点，其余存进 `metadata.alternates`；用户「设为首图」（Agent 对应 `workflow.batch.pick`）选中的那张就是 chosen，同批没被选的是 rejected。这些样本的提示词和输入完全相同，是天然的对照实验，而且不额外花钱。

> 待做：「设为首图」目前只交换媒体字段，没有留下事件记录。要采集偏好对，需要在 pick 时记录 `{nodeId, chosen, rejected, prompt, model}`（不含媒体本体）。

三层架构（`lib/autorubrics.mjs`）：

| 层 | 做什么 | 实现 |
| --- | --- | --- |
| 1 供给 | 对每个偏好对多轮采样，挖掘「chosen 为什么更好」的可检查规则，并以数据统计结果作为事实锚点；然后语义去重 | `miningPrompt`、`dedupeRules`（词面去重；语义合并交给 LLM） |
| 2 筛选 | **双侧违反率**：bad 违反率 ≥ 70% 且 good 违反率 ≤ 20% 为强规则；good 违反率 > bad 违反率为假规则（方向反了）；两侧差异 < 20% 为低区分度。然后做 **K 折稳定性筛选**：只保留在各折里都被选中的规则，并报告训练与验证的准确率差距 | `screenRule`、`stabilitySelect` |
| 3 验证 | 一个偏好对只有在每一轮的规则判断都与人的选择一致时，才进入可信集（golden set） | `trustedPairs` |

规则池会持续演化（`updateMemory`）：新通过的为 active，一轮没通过降为 degraded，连续两轮没通过就移除，降级后重新通过则恢复。筛出来的强规则交人工复核，再并入对应 Rubric 的 `pairwiseCriteria` 或子项，并升版本。

要防的两个陷阱：

- **位置偏差**：所有成对判断都做交换，只认顺序无关的结论。
- **选择过拟合**：候选规则多、偏好对少时，贪心选择很容易在训练折上表现好、在验证折上崩。`stabilitySelect` 会报 `overfit`（训练与验证准确率差 > 15pp）；如果没有一条规则的入选频率达到 80%，就继续积累偏好对，不急着上线。

## 7. 四步质量归因（评完怎么办）

1. **分层诊断**：看漏斗报告里的主因层和子项失败分布。
2. **根因定位**：每个存疑样本都必须先归到一类，再决定改什么（`lib/attribution.mjs`）：

| 根因 | 典型表现 | 修哪里 | 影响面 |
| --- | --- | --- | --- |
| 数据 | 证据被截断、混入系统提示词、跨轮串扰、字段映射错 | 采集脚本、`clean.mjs` | 该来源的同类样本 |
| Prompt | 解析失败多；单个子项 kappa 偏低；边界情况没有示例 | Rubric 正文的判定说明、`fewShot` | 该 Rubric 的同类样本 |
| Rubric | 人工认为产品行为正确，条目却判 0；离线分高但采纳率低 | Rubric 条目本身，升版本 | 该 Rubric 的全部样本，需要重跑对比 |
| Agent | 排除以上三类之后剩下的失败 | Skill、Agent 提示词、工具实现、模型路由 | 对应的能力 |

3. **路由优化**：

| 信号 | 根因 | 优化通道 |
| --- | --- | --- |
| 解析失败比例高 | Prompt | 收紧输出 schema 和示例，不要先改 Agent |
| 失败集中在被清洗改动过的样本 | 数据 | 先修采集和清洗，再重跑 |
| 某个子项 kappa 低，其他正常 | Prompt | 补这个子项的边界说明和示例 |
| 人工判产品行为正确，Rubric 判 0 | Rubric | 改条目并升版本 |
| pass@1 高，pass^5 低 | Agent | 稳定性问题：加约束、固定参数、改 Skill |
| 成对比较训练集准、验证集差 | Rubric | 重新筛规则，补偏好对 |
| 离线通过率高，采纳率低 | Rubric | Judge 没对齐用户偏好，用偏好对重新校准 |

4. **回归验证**：修完后在**同一批样本**上重跑，用 `gate` 和上一次的结果对比；修好的样本加入回归集。

早期最常见的误区，是一看到通过率下降就去改 Prompt。根因如果在数据层或 Rubric，改 Prompt 只会把问题盖住。多轮迭代的目标是让通过率**更可信**，而不是让它变高。

## 8. 三阶段上线治理（如何上线）

适用于 Agent 提示词、Skill、模型路由、Rubric 本身的任何变更。

| 阶段 | 做什么 | 通过条件 | 红线 |
| --- | --- | --- | --- |
| **准入** | 变更绑定回归跑批：FlovartBench（规则层）+ 相关 Rubric 在同一批样本上对比基线 | 规则层 100% 通过；RED 失败为 0；Judge 通过率下降不超过 2pp；Judge 与人工 kappa ≥ 0.6；位置交换一致率 ≥ 0.8；没有解析失败（`lib/gate.mjs` `admissionGate`） | 任何一条不满足就阻断 |
| **灰度** | 新旧版本同时运行，例如新 Skill 只用在部分项目，或同一请求生成新旧两版放进备选，比较采纳率 | 连续 N 天采纳率不低于对照 | 实验组连续 2 天低于对照就暂停放量并触发归因（`grayGate`） |
| **监控** | 定期按 Rubric 抽样评测；用户丢弃的结果回流成 Bad Case | 通过率留在基线的 Wilson 区间内 | 超出区间判为漂移，走第 7 节的归因流程（`driftCheck`），而不是直接改 Prompt |

## 9. 怎么跑

```bash
# 规则层（FlovartBench）
npm run eval:validate
npm run eval:core
npm run eval:report

# Judge 层
npm run eval:judge:validate                                  # 校验全部 Rubric 契约
npm run eval:judge -- compile --rubric agent-run             # 查看由 Rubric 生成的 Judge Prompt
npm run eval:judge:demo                                      # 用回放输出跑示例样本，不花钱
npm run eval:judge -- judge --rubric agent-run --samples <样本.jsonl> --labels <标注.json> --rounds 3
npm run eval:judge -- pairs --rubric image-output --pairs <偏好对.jsonl> --truth <人选.json>
npm run eval:judge -- screen --violations <违反记录.json>    # Auto Rubrics 第 2 层
npm run eval:judge -- gate --baseline <旧结果目录> --candidate <新结果目录>
npm run eval:judge -- sample-size --margin 0.01
```

Judge 模型通过环境变量配置，可以接任何兼容 Chat Completions 的服务：`FLOVART_JUDGE_BASE_URL`、`FLOVART_JUDGE_MODEL`、`FLOVART_JUDGE_API_KEY`（不写进任何结果文件）。图像和视频 Rubric 需要支持图像输入的模型；视频按时间均匀抽关键帧（`ffmpeg -vf fps=…`），作为图像附带，帧的时间点写在 `frames_meta` 里。`--replay <file.jsonl>` 用录下来的输出重评，CI、改解析器后重评都不花钱。

结果写在 `eval/judge/results/<时间>-<rubric>/`（不进 git）：`results.jsonl`（逐样本、逐子项）、`summary.json`、`report.md`（漏斗、主因、子项失败、一致性、归因）。

### 9.1 真实 trace 的采集

基础功能评测（见 `docs/quality/2026-11-15-basic-function-eval.md`）用的是这条链路，可以照着把真实会话变成 `agent-run` 样本：

1. 起服务：`node tools/flovart/cli.js start --source --json --no-open`。访问本机 Agent 时要去掉 HTTP(S)_PROXY。
2. 起一个无头浏览器会话连上 WebUI：`FLOVART_CHROME_PATH` 指向 headless shell，并加上 `--disable-web-security`。界面操作通过 Playwright 片段注入。
3. 所有 CLI 调用都经过一个包装脚本，把命令、参数、返回码、关键返回字段追加写进 `trace.jsonl`。
4. 每个用户请求结束后执行一次 `workflow.inspect`，作为 `final_state`，并记下 Agent 的最终回复。
5. 把一个请求的 trace 组装成一行样本 `{id, turnId, evalTime, slice, inputs: {user_request, tool_calls, final_state, agent_reply, cost_plan}}`。清洗层会负责脱敏和跨轮隔离。

付费生成先用 price-preview 估价；预算和实际花费记在当次的 `docs/quality` 记录里。

## 10. 目录

```
eval/
  eval.md                  本文：评测体系总说明
  README.md                规则层（FlovartBench）跑法
  references/              参考文章（HTML 只在本地）
  run.mjs lib/ tasks/ ...  规则层
  judge/
    run.mjs                Judge CLI
    rubrics/*.md           Rubric（版本化，Prompt 由它生成）
    lib/rubric.mjs         Rubric 契约与 Prompt 生成
    lib/clean.mjs          四层清洗
    lib/judge.mjs          单点判定与多轮一致
    lib/parse.mjs          输出三层防线
    lib/funnel.mjs         六层漏斗与汇总
    lib/pairwise.mjs       成对比较与位置交换
    lib/agreement.mjs      kappa、Wilson 区间、样本量
    lib/autorubrics.mjs    Auto Rubrics 三层
    lib/attribution.mjs    四步归因与路由表
    lib/gate.mjs           准入 / 灰度 / 监控
    samples/               示例样本、回放输出、人工标注
tests/evalJudge.test.ts    Judge 层单测
```

## 11. Rubric 背后的制作经验

L2 和 L4 的 Rubric 条目，来自团队三份真实项目的复盘（数字人口播、春晚首尾帧短片、AIGC 工作流演变）。下面只记结论，具体工作流和应用链接留在原文档里。

- **方向**：多人同框的难度和工期都高；要保证真实感，实拍加 AI 效果最好；AI 更适合做初稿和超现实题材。
- **前期**：数字人先实拍并设计好动作，摊手介绍之类的动作保持 1–2 秒；用直播间的打光和绿幕；拍完先做形象美化，再拿去生成。动态更强的模型动作往往偏浮夸。
- **首尾帧**：先用底图模型出首图（「Classical Realism / 古典写实」能兼顾准确和厚重感），再用图像编辑模型做换脸换装、生成尾帧；有的视频模型适合大部分镜头，有的尾帧保持更好，用来补漏和处理一致性要求高的镜头。连续镜头用上一镜头的尾帧做下一镜头的首帧，代价是不能并发。
- **倒放接片**：首尾帧模型一般只能保证首帧对上。只有前半段可用时，从最后一帧接着生成；只有后半段可用时，取后半段的首帧生成满意的动作，再倒放接上。
- **换脸与口型**：先换脸再对口型，换脸参考用正脸图，即使视频里是侧脸；换脸后对口型可能让脸乱动，要逐段检查。补帧加高清放大是有效的后期组合。
- **图像**：换装加无背景参考，人物一致性好；指定背景后质量明显下降（人不像、logo 变形），可以改成绿幕合成后再让 AI 融合，或者先生成背景正确的画面再换脸。
- **视频中的文字**：部分模型会把画面里正确的中文变成乱码；对文字有要求时，选中文更稳的方案，或者后期再加字。动作幅度大时脸仍然会崩，需要最后再叠一次换脸。
- **声音**：打鼓这类强节奏画面最好有自己的配音，自动补音效的效果不够好；AI 翻唱训练集要做人声分离，多人合唱的歌会带来杂音。
- **提示词**：视频提示词分正向和负向，中英双语，像写分镜一样写清镜头、运镜和可量化的细节；把同一条指令重复两遍，有时效果更好。
- **Agent 产品**：现有画布 Agent 常见的问题是不能直接替换节点、被打断后会忘记任务、不连接原始参考图。这些正是 `agent-run` 里 HONEST 和 TOOL 层要抓的。

## 12. 外部参照

- **τ-bench**：比对环境终态，报 pass^k。对应 FlovartBench 的终态断言和 pass^5。
- **SWE-bench Verified**：题目先经人审，删掉描述含糊的题。对应任务准入要求的 Oracle ×5 和 NOP 失败。
- **MT-Bench / Chatbot Arena**：指出了位置偏差、冗长偏差和自我偏好。对应成对比较的顺序交换，以及「不因长而加分」这条纪律。
- **HealthBench、PaperBench**：每个任务配一份专属的加权 rubric，并对 Judge 本身做元评测。对应按领域划分的 Rubric 和 Judge 验证集。
- **Rubrics as Rewards**：同一套 rubric 既做评测也做奖励。对应以后用 Rubric 筛选训练数据。
- **字节 Seed 的公开报告**：Seedream 4.0 的 MagicBench 和 DreamEval，把评测拆成细粒度的 VQA；Seedance 的 SeedVideoBench 看运动质量、指令遵循、美学和原图保持，用 5 分制打分加 GSB 成对比较。对应 L4 的子项设计和成对比较。这些报告没有公开 rubric 原文和一致率。

## 13. 现状

已完成：Rubric 契约与 Prompt 生成、四层清洗、输出防线、六层漏斗、多轮一致、位置交换、kappa / Wilson / 样本量、Auto Rubrics 的筛选与记忆、四步归因、三阶段门禁、6 份 Rubric、回放示例与单测。

待做：

1. 「设为首图」时记录偏好事件（不含媒体本体），作为 L4 的真实信号。
2. 视频关键帧的抽帧脚本：从 take 生成 `frames_meta` 和图像输入。
3. 在真实 Judge 模型上跑首批人工标注（每份 Rubric 至少 100 条），把 kappa 做实。
4. 把 `gate` 接入 CI，作为 Skill、提示词变更的准入门禁。
5. 首次用 Auto Rubrics 从偏好对挖出规则后，人工复核再并入 Rubric。
