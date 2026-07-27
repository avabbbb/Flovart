# Flovart Skill + CLI 真实短片制作评估

## 结论

当前架构已经证明“Coding Agent + Flovart Skill + CLI + 系统密钥环中的一个 Provider Key”可以完成一次真实的选题研究、素材生成、任务监控、本地后期、交付校验和可见 Workflow 节点同步。

但它目前是**可工作的制作内核**，还不是“安装任意导演 Skill 后一键稳定交片”的成熟产品。此次 60 秒短片仍由 Coding Agent 编排十个生成任务，并用评测目录脚本完成旁白、字幕和合成。要开放 VOX 等 UGC 导演 Skill，仍需把 ProductionRun、预算批准、后期命令、Artifact Projection 和第三方 Skill 权限变成正式 Runtime 契约。

综合评分：**7.2 / 10**

- 制作能力：8/10。真实完成 5 张图、5 段视频和 60 秒成片。
- 控制可靠性：8/10。Runtime、幂等任务、事件和 Workspace 同步均有真实证据。
- 自动化完整度：6/10。旁白、合成和质检仍是本地脚本，不是一等命令。
- UGC Skill 就绪度：5/10。能移植导演工作流，但缺少 manifest、权限、预算和版本兼容层。
- 可观测性：8/10。TUI 可看 Runtime、Workflow、Tasks 和 Events，但还不能在 TUI 内批准费用或预览 Artifact。

## 本轮实现

### 1. 内置 30 天选题研究

新增 `research.topic.collect`，作为独立 Research Adapter，而不是伪装成 Production Runtime：

- 支持 Reddit 和 X 的来源结构、时间窗、子版块、账号列表、数量限制、输出目录和稳定幂等键。
- Reddit 使用 Atom RSS，并显式记录代理、抓取数量、缺失来源和警告。
- X 只允许走已认证适配器；缺少凭据时返回 `degraded`，不会用搜索摘要伪造 X 覆盖。
- ready/degraded 结果可按相同幂等键回放；失败结果允许修复网络后重试。
- 生成 JSON 和 Markdown 两种研究制品。

`last30days` 基线在本机因 Reddit JSON 403 得到 0 条 Reddit 证据；新的 Flovart Adapter 在同一环境通过系统代理获得 25 条 Reddit RSS 条目。这个对照说明“来源覆盖状态”必须是命令契约的一部分。

真实研究制品：

- `flovart-research/reddit-politics-2026-07-25-v1.json`
- `flovart-research/reddit-politics-2026-07-25-v1.md`
- `research/hottest-political-topic-on-reddit-raw-flovart-baseline.md`

### 2. Production Runtime 图像与低价视频路线

Canonical Registry 新增可执行 `generate.image`，并扩展 `generate.video`：

- GPT Image 2：`rhart-image-g-2/text-to-image`
- Grok Imagine Video 1.5 低价渠道：`rhart-video-g/text-to-video`
- Grok 低价路线按官方文档固定为 6 秒、720p；首次用旧 5 秒参数时，价格预检返回业务错误 1007，Runtime 在提交前阻止任务，没有 Provider task ID。
- Provider Key 仅从 Windows Credential Manager 读取；CLI、日志和制品中没有明文 Key。

官方能力依据：

- [OpenAI GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2)
- [xAI Imagine / video generation](https://docs.x.ai/developers/model-capabilities/video/generation)
- [RunningHub GPT Image 2 路线](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183264)
- [RunningHub Grok Imagine Video 1.5 低价路线](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183149)

### 3. OpenCode / pi 风格 TUI V1

`flovart tui` 已改为 Ink Terminal Command Center：

- 顶部显示 Runtime、Workflow、Task 和 Event 状态。
- 中部显示持久任务列表和最新命令输出。
- 每 2.5 秒通过 canonical CLI 子进程刷新，不复制 Runtime 状态。
- 支持 `/runtime`、`/workspace`、`/tasks`、`/research <topic>`、`/models`、`/run`、`/start`、`/clear`、`/help`、`/exit`。
- `--snapshot` 支持无 TTY 回归测试。

它目前是观察和命令入口，不是新的权威状态层。下一版应加入 task drill-down、价格批准、Artifact 预览和 Agent token stream。

### 4. CLI JSON 参数可靠性修复

真实画布测试第一次在 `workflow.node.create --metadata <json>` 失败：schema 声明对象，但 Workspace 路径没有像 Runtime 路径一样反序列化 JSON 字符串。现已统一解析 `metadata`、`patch` 和 JSON 数组形式的 `ids`，并补了回归测试。

这个缺陷正是“本地 Agent 内部调用可用，但 Skill + CLI 不稳定”的典型原因：Agent 直接传 JavaScript 对象，而 PowerShell、zsh、WSL 和子进程边界只能传字符串。CLI 必须在边界把字符串恢复成 schema 类型。

## 真实选题与事实边界

Reddit RSS 排名与网页热度补充都指向同一主题：南卡罗来纳州参议员 Lindsey Graham 去世，以及空缺席位如何触发临时任命和 11 月选举。

热度证据：

- [r/politics 汇总帖](https://www.reddit.com/r/politics/comments/1uuc683/megathread_south_carolina_senator_lindsay_graham/)：测试时页面显示约 2.21 万票。
- [r/politics 制度解释帖](https://www.reddit.com/r/politics/comments/1uuftr8/lindsey_grahams_death_will_shake_the_senate_and/)：测试时页面显示约 1.76 万票。

事实核验：

- [AP：Darline Graham 宣誓并竞选完整任期](https://apnews.com/article/ef319a09b47a57b8c31950b90ed4f82b)
- [AP Fact Check：官方死因仍待毒理和显微检验](https://apnews.com/article/5a9b75ffb00ec8435723f65e224b98f5)
- [South Carolina Public Radio：席位继任与选举流程](https://www.southcarolinapublicradio.org/sc-news/2026-07-13/what-u-s-sen-lindsey-grahams-death-means-for-his-senate-seat)

成片采用中性制度解释角度《一把空椅子，如何改变一场选举》，不做候选人劝服、不使用未经证实的死因推断，也不生成可识别政治人物的写实肖像。

## 真实生成结果

### Tracer bullets

| 类型 | Task ID | Provider Task ID | 路线 | 价格预览 | 结果 |
| --- | --- | --- | --- | --- | --- |
| GPT Image 2 | `task_019f9511-f256-70b3-ad30-44076635079c` | `2080699581397868546` | `rhart-image-g-2/text-to-image` | ¥0.10 | PNG，2,709,114 bytes |
| Grok 1.5 | `task_019f9519-02e3-7b21-bd3e-86479e0686a6` | `2080701523041853441` | `rhart-video-g/text-to-video` | ¥0.24 | MP4，6.042 秒 |

### 完整素材批次

- 成功任务：10/10，包括 5 张 GPT Image 2 图片和 5 段 Grok 1.5 视频。
- 追加 8 个任务的顺序队列耗时：499.548 秒。
- 从首个 tracer 到最后素材完成：1,338.374 秒，包含旧 Grok 参数失败、路线核对和 Runtime 重启。
- 价格预览合计：¥1.70。它是提交前估价，不等同于 RunningHub 最终账单。
- 旧 5 秒 Grok 参数任务在价格预检失败，没有 Provider task ID，未进入生成。

RunningHub Grok 路线即使收到 `generateAudio=false`，下载的 MP4 仍含 AAC。最终合成明确丢弃所有模型音轨，只使用统一中文旁白。

## 成片交付

文件：`reddit-politics-one-empty-chair.mp4`

- 时长：60.000 秒
- 画面：1280×720，24 fps，H.264
- 声音：AAC，中文旁白
- 字幕：10 段中文硬字幕
- SHA-256：`9f442189bb607a1dab42a8035417ea02cafddf934ebaf822d0cddd21cd1771c8`
- 源任务：10 个可追踪 Runtime task
- 统一视觉：纸雕 / 报纸拼贴 / 克制的红蓝米白配色

视觉检查结果：

- 优点：十个镜头的纸雕语言、配色和制度图示非常统一；Grok 动画与 GPT 静帧能够在剪辑中互相衔接。
- 缺点：部分 GPT Image 2 静帧仍生成了英文标题或标签，违反“无可读文字”的提示约束。成片可用，但正式导演流水线应增加 OCR Gate，并对命中的镜头自动重做或局部擦除。
- 旁白使用 Windows `Microsoft Huihui Desktop`，53.811 秒后补静音至 60 秒。它适合测试，不是最终商业配音质量。

验证制品：

- `film-verification.json`
- `contact-sheet.png`
- `narration.metadata.json`
- `tasks.final.json`

## 真实 Workflow 同步

Playwright 在真实 `/#/app` 页面连接本机 Agent 后，CLI 完成：

1. 创建 `Reddit 政治热点 · 一把空椅子` 项目。
2. 创建研究节点。
3. 原子创建并连接脚本节点。
4. 把“旁白脚本 v0”细修成完整旁白并移动到新坐标。
5. 创建并连接生成配置节点。
6. 创建并连接最终视频 Artifact 元数据节点。
7. 选择最终节点并更新视口。

断言结果：4 个节点、3 条连线、脚本坐标 `{x:500,y:140}`、最终 SHA 与交付文件一致、浏览器 console error 为 0。

证据：

- `workflow-sync-verification.json`
- `workflow-cli-sync.png`

目前 Runtime Artifact 只有私有 `storeRelpath`。Workflow 节点能同步 `artifactRef`、SHA、时长和状态，但浏览器没有受控的 Artifact URL，因此最终视频节点不能自动播放。不能用 `file://` 或把私有路径塞进画布绕过这个边界；应实现只读 `workflow.projection.get` 和受鉴权的 Artifact stream URL。

## 架构判断

### 已经成立

- Skill 可以做制作总台：研究、计划、调用正式命令、监控任务、执行质量 Gate。
- CLI 可以做同一套能力的确定性控制面，PowerShell、macOS、WSL 共用 Node CLI；差异只应存在于安装和本机配置路径。
- Desktop Runtime 正确拥有 Key、Provider task、事件和 Artifact。
- Browser Workspace 正确拥有用户可见项目、节点、连线、选择和视口。
- TUI 只观察和调用两侧，不制造第三份状态。
- 风格化 Director Skill 可以输出 ProductionSpec、镜头 Prompt、质量规则和重做策略，而不直接接触 Key。

### 尚未成立

- 还没有正式 `ProductionRun → Shot → Take → Artifact → Delivery` 状态图。
- 还没有整片价格预览、费用上限和用户批准 Gate。
- 旁白、字幕、混音、合成、OCR、响度和交付验证还不是 Runtime 命令。
- 单 worker 使 8 个追加任务耗时约 8 分 20 秒；没有 Provider 感知的并发与限流策略。
- X 只有安全的适配结构，没有完成真实认证采集测试。
- Runtime Artifact 尚未投影为可恢复、可播放的 Workflow 节点。
- 第三方 Director Skill 尚无签名、权限、Secret 隔离、预算配额和兼容版本。

## 对 VOX + Flovart Skill 的判断

`vox-director` 可以作为“导演层”接入，但不应让它直接调用 RunningHub 或操纵浏览器内部对象。建议的稳定边界是：

1. VOX Skill 输入主题、时长、语言和风格参数。
2. VOX Skill 输出版本化 ProductionSpec、镜头表、旁白草案和视觉 Gate。
3. Flovart Skill 验证 capability、预算和来源覆盖。
4. Flovart CLI/Runtime 执行生成、监控和 Artifact 保存。
5. Workflow Projection 把 Shot/Take 显示到画布。
6. Coding Agent 根据 OCR、风格一致性和事实 Gate 只重做失败镜头。

因此答案不是“现在即插即用”，而是“制作内核已经验证；补齐 Director Manifest 与 ProductionRun 后，VOX 才能成为可靠的 UGC 导演插件”。

## 自动验证

- 单线程全量 Vitest：75 个文件、624 项通过、1 项跳过；仅 `tests/workflowGeneration.test.ts` 保留 6 项既有失败，未再出现并发资源争用造成的超时。
- 本轮定向 Vitest：研究、Runtime/Registry、Provider Route、Workspace CLI 同步与 TUI 共 186 项通过；CLI JSON 边界修复的 Workspace 回归 21/21 通过。
- Rust Runtime：`cargo test --lib` 4/4、`runtime_contract` 5/5、`runtime_ledger` 5/5、`runtime_recovery` 3/3；`cargo fmt --check` 与 debug binary build 通过。
- `npx tsc --noEmit`、`npm run build`、CLI `npm pack --dry-run --json`、两份 Flovart Skill 结构校验与 `git diff --check` 通过。Web 构建只保留既有 chunk size 与静态/动态混合导入警告。
- 真实验收不是 mock：Reddit 拉取 25 条、RunningHub 10 个素材任务完成、60 秒 MP4 经 ffprobe 验证、浏览器画布由 PowerShell CLI 创建 4 个节点和 3 条连线，console error 为 0。

## 使用方式

启动 TUI：

```powershell
npm run flovart:cli -- tui
```

TUI 中收集 Reddit + X 结构化选题：

```text
/research 美国政治
```

PowerShell 直接收集 Reddit：

```powershell
npm run flovart:cli -- research.topic.collect `
  --topic "Reddit 政治热点" `
  --sources '["reddit"]' `
  --subreddits '["politics","PoliticalDiscussion","news"]' `
  --days 30 `
  --limit 25 `
  --idempotency-key "reddit-politics-demo-v1" `
  --json
```

连接画布后检查和细修：

```powershell
npm run flovart:cli -- workspace.status --json
npm run flovart:cli -- workflow.inspect --json
npm run flovart:cli -- workflow.node.update `
  --node-id "reddit-script" `
  --patch '{"title":"旁白脚本 · 已细修"}' `
  --idempotency-key "script-finetune-v1" `
  --json
```

每条写命令都必须使用稳定幂等键；`workspace.status` 不是 `ready` 时应停止，不得写 shadow state。
