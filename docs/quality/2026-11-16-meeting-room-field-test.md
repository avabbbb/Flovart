# 2026-11-16 会议室照片实测（Flovart 托管站 + RunningHub 国内站）

> 实测记录，未提交。执行时间 2026-11-16 12:18–12:33（UTC+8）。环境：https://flovart.avabbbb.com/#/app，headless session browser（Remotion headless_shell，`--auto-approve`、`--disable-web-security`），本地 agent `http://127.0.0.1:17373`。模型：Seedream 5.0 Flash（RunningHub 国内站，`seedream-v5-flash/image-to-image`）。

## 1. 目标

老板下午要用：以用户提供的两张现场参考照为风格，生成
- 3 张**空会场**（不同角度）；
- 3 张**同一会场坐满约 30 人**（不同角度，中国政府 / 行业研讨会，商务正装）；
- 主屏幕标题「筑牢AI安全防线，守护智能未来——佛山市民政行业安全交流研讨会」，2026年11月19日，佛山华美达酒店。

要求优先用画布内的 Agent 对话面板完成，Agent 不行再退回 CLI，失败都记下来。预算 ≤1.5 元。

## 2. 结论（先看这里）

- **6 张图全部交付**，标题文字 6/6 正确（其中 1 张用短标题重试了一次），同一会场的一致性很好。**花费 0.77 元**（7 张 × 0.11），在 1.5 元预算内。
- **画布内 Agent 对话面板没能用起来**：只配了 RunningHub（图片/视频服务）时，一发消息就报「需要正在运行的协作方（Codex / Claude / OpenCode）或 AI 服务」，而顶栏同时显示「Ready · Agent」。首页「What do you want to make?」只建出 1 个空节点。**真正出图全部靠 CLI**（`create-connected` + 逐个 `node.run`）。
- 拖图体验：拖到**画布空白处**能直接生成图片节点（约 5 秒，接近 RHTV）；拖到**输入框**不行：首页输入框没反应，Agent 输入框只把图变成对话附件，不会放上画布。
- 复现了 `REVISION_CONFLICT`（「Workflow 草稿版本已变化」），复现步骤见第 7 节。

## 3. 步骤、耗时与成败

| # | 步骤（用户视角） | 方式 | 耗时 | 结果 |
|---|---|---|---|---|
| 0 | 打开站点，状态显示「No AI service」 | UI | — | session 换了新 profile，之前配的 Key 没了 |
| 1 | 设置 → + Add AI service → RunningHub，填 Key，点「Validate and save」 | UI | 约 20 s（验证中） | ✅ 绿点，内置模型表里已有 `seedream-v5-flash/text-to-image` 和 `/image-to-image`；映射里 Seedream 5.0 Flash 有 2 条线路 |
| 2 | 把 2 张参考图拖进首页「What do you want to make?」输入框 | UI | — | ❌ 毫无反应（没上传，也没建画布） |
| 3 | 在首页输入框写下 6 张图的完整需求，点 Start | UI | 7.2 s | ❌ 只建了 1 个工作流和 **1 个空 Image 节点**；需求没写进节点；工作流标题就是截断的需求原文 |
| 4 | 打开画布右侧 Agent 面板，把 2 张参考图拖进输入框 | UI | <1 s | ⚠️ 只变成对话附件缩略图，**没有放到画布上** |
| 5 | 在 Agent 面板发送需求（中文，指定 Seedream 5.0 Flash） | UI | 8.5 s | ❌ 报错「Flovart needs a running collaborator such as Codex, Claude, or OpenCode… or add an AI service」。发完后输入框里的文字没有清空，再发一次是同样的错误 |
| 6 | 把 2 张参考图拖到画布空白处 | UI | 5.2 s | ✅ 生成「图片 2 / 图片 3」两个节点（原尺寸 1080×1440、1440×1080），版本 rev 1→7；但「图片 3」压在了已有的空 Image 节点上 |
| 7 | 从参考图（会场全景那张）连出 empty-1 节点，并写好 prompt、modelId、16:9、2K | CLI `create-connected` | 2.3 s | ✅ |
| 8 | 运行 empty-1 | CLI `node.run` | 19.8 s | ✅ 自动走 `seedream-v5-flash/image-to-image`，输出 2048×1152，计费回填 `actual 0.11` |
| 9 | 以 empty-1 为参考图，连出 empty-2/3、full-1/2/3 共 5 个节点 | CLI ×5 | 2.2–3.2 s/个 | ✅ |
| 10 | 逐个运行（避开批量 `--node-ids` 的已知 bug） | CLI ×5 | 18.1 / 16.6 / 22.5 / 24.2 / 22.8 s | ✅ 5/5 |
| 11 | full-3 标题漏了「防」字 → 按规则用短标题重试 1 次 | CLI | 1.5 s + 23.7 s | ✅ 文字正确 |
| 12 | 给节点改名（run 之后标题全被改回「图片生成」） | CLI `node.update` | 1.5–3.6 s | ⚠️ `--title` 被静默忽略，报「写入内容与当前节点完全一致」；改用 `--patch-json '{"title":…}'` 后 6/6 成功 |
| 13 | 复现 REVISION_CONFLICT | UI 拖动 + CLI | 1.5 s | 已复现，见第 7 节 |

一键成功率：UI 路径（首页输入框 / Agent 面板）**0/2**；CLI 生成 **7/7**（含 1 次重试）。从开始配置到 6 张图到手约 **10 分钟**，纯生成时间约 2.5 分钟。

## 4. 花费

| 步骤 | 元 |
|---|---|
| empty-1、empty-2、empty-3 | 0.33 |
| full-1、full-2、full-3（第一版） | 0.33 |
| full-3 短标题重试 | 0.11 |
| **合计** | **0.77** |

已逐条追加到 `.tmp/eval/cost.jsonl`（step 以 `meeting` 开头）。RunningHub 任务查询返回 `thirdPartyConsumeMoney: 0.11`，节点上 `generationBillableState: actual`，说明 11-15 修的计费回填已经生效。

## 5. 图片质量

做法：empty-1 用用户那张会场全景照作参考（图生图）；其余 5 张都用 **empty-1 作参考**，这样整组看起来是同一个会场。

| 图 | 机位 | 主屏标题 | 人数 | 备注 |
|---|---|---|---|---|
| empty-1 | 后方中轴正对主屏 | ✅ 主标题、副标题、日期、酒店全对 | 0 | 构图最好；桌牌上的字是乱码 |
| empty-2 | 侧前方斜拍 | ✅ | 0 | 机位变化不太明显，更像后方偏右 |
| empty-3 | 右后角高位俯拍 | ✅ | 0 | 俯视角度明显，角度区分度好 |
| full-1 | 后方中轴，背影，有发言人 | ✅ | 约 60 | 人数比「约 30」多一倍 |
| full-2 | 侧面，看得到侧脸 | ✅（日期笔画略糊） | 约 50 | 自然 |
| full-3（终版，重试） | 主席台面向观众 | ✅ 短标题「筑牢AI安全防线 / 2026年11月19日」 | 约 45（前排坐满、后排空） | 用短标题换来文字正确，但屏幕上没有副标题和酒店名；前排几张脸长得很像（「克隆脸」） |
| full-3 第一版（已弃用） | 同上 | ❌「筑牢AI安全**线**」漏「防」，「华美达」写成「华荟达」 | 约 60 | 留档：`full-3-v1-title-error.jpg` |

- **标题文字**：Seedream 5 Flash 渲染中文大字很稳，7 张里只有 1 张出错；屏幕在画面边缘、透视越大越容易出错。小字（桌牌）全部是乱码。
- **人数**：只写「约 30 人」会出 50–60 人；写成「坐前五排、后排空着」才接近目标。
- **一致性**：吊顶、水晶灯、深蓝桌布、酒红椅套、地毯、窗帘在 6 张里都一致，明显好于纯文生图。
- **能否直接用**：远看可以当会议照；近看桌牌乱码、人脸重复，正式宣传前建议人工看一遍。

## 6. 和 RHTV 对比（按用户描述）

| | RHTV | Flovart（本次实测） |
|---|---|---|
| 把图拖进输入框 | 直接上传并**放到画布上** | 首页输入框：没反应。Agent 输入框：只变成对话附件，不上画布 |
| 把图拖到画布 | — | ✅ 约 5 s 就建好图片节点，按原尺寸显示；但会压住已有节点 |
| 参考图怎么用 | 输入框里的图直接当参考 | 需要从图片节点**连线**到生成节点（`create-connected`，或者在 UI 里拉线 / 用 @ 引用），连好后会自动切到图生图 |
| 用一句话要多张图 | — | 首页输入框只建 1 个空节点；Agent 面板需要另配文本 LLM 或外部协作方 |

感受：用户最自然的动作就是「把图拖进输入框」，在 Flovart 里这一步行不通，得知道要拖到画布上，这是这次最明显的落差。另外附件留在对话里，Agent 又用不了，图就卡在那儿了。

## 7. REVISION_CONFLICT（「草稿版本已变化」）

本次复现了（实际生成过程中没有自然出现）：

1. `workflow.inspect` → `draftVersion: 21`；
2. 在 UI 里拖动画布上的一个节点（参考图节点），版本变成 22；
3. `workflow.node.update --project-id … --node-id node-mt-full3b-create --patch… --expected-revision 21 --idempotency-key …`
4. 返回 `REVISION_CONFLICT`：「Workflow 草稿版本已变化：期望 21，当前 22。」，`retryable: false`，details 里有 `expectedRevision` 和 `actualRevision`。

问题：用户只是挪了一下另一个节点的位置，和这次补丁不冲突，却被直接拒绝，而且标记为不可重试。Agent 照字面理解就会放弃。建议：位置类改动或不相交的节点不判冲突；或者至少标成 `retryable: true`，并提示「先重新 inspect 再重试」。

## 8. 问题清单

| 严重度 | 问题 |
|---|---|
| **高** | 画布内 Agent 对话面板只认文本 LLM 服务或外部协作方。只配 RunningHub 时一发消息就报错，顶栏却显示「Ready · Agent」（状态矛盾）；本地 agent 已连接也不算协作方。要测的主流程因此走不通 |
| **高** | 首页「What do you want to make? / Flovart wires the nodes」提交需求后只建了 1 个空 Image 节点，没拆成多个节点、prompt 也没写进去，和文案承诺不符 |
| **中** | 拖图进输入框不上画布（首页没反应；Agent 输入框只变成附件），和 RHTV 的习惯不一样，用户找不到上传参考图的入口 |
| **中** | 节点运行后标题被改回「图片生成」，6 个结果同名，图层面板里分不清 |
| **中** | PromptBar 默认模型是 GPT（GPT Image 2，RunningHub 国内站返回 40310 不可用），用户不改模型就会失败 |
| **中** | `REVISION_CONFLICT` 对不冲突的并发改动（UI 挪节点）也拒绝，而且 `retryable: false` |
| **低** | `workflow.node.update --title` 是未知参数，被静默忽略，返回误导性的「写入内容与当前节点完全一致」；应该报「未知参数，请用 --patch-json」 |
| **低** | 拖入的图片节点压在已有节点上；`create-connected` 出的 5 个节点竖着排成一长列 |
| **低** | Agent 面板发送失败后输入框不清空，附件也一直留着 |
| **低** | 托管 HTTPS 站点的 Agent 页写「无法连接本地 agent」，实际（测试环境下）已连接，文案和状态不一致（受测试环境影响） |
| **模型侧** | 中文大字 1/7 出错，小字（桌牌）全乱码；「约 30 人」实际出 50–60 人；前排人脸重复 |

以上问题也追加到了 `.tmp/eval/issues.md`（前缀「会议室实测」）。

## 9. 产物路径

- 最终 6 张图：`.tmp/eval/meeting/empty-1.jpg`、`empty-2.jpg`、`empty-3.jpg`、`full-1.jpg`、`full-2.jpg`、`full-3.jpg`（都是 2048×1152）
  - 留档：`full-3-v1-title-error.jpg`（标题出错的第一版）、`full-3-retry.jpg`（和 `full-3.jpg` 相同）
  - RunningHub 任务 ID 和原图 URL：`.tmp/eval/meeting/urls.txt`
- 流程 GIF：`.tmp/eval/video/meeting-demo.gif`（约 16 s，800 px，结尾附 6 张成图）；MP4：`.tmp/eval/video/meeting-demo.mp4`
- 截图：`.tmp/eval/shots/meeting-00-start.png` … `meeting-15-final-canvas.png`。关键几张：
  - `meeting-04-service-saved.png`：服务保存成功
  - `meeting-08-start-submit.png`：首页提交后只有一个空节点
  - `meeting-10-drop-agent-input.png`：拖进 Agent 输入框只变成附件
  - `meeting-11-agent-send.png`：Agent 报错
  - `meeting-12-drop-canvas.png`：拖到画布成功
  - `meeting-13-canvas-results.png`、`meeting-15-final-canvas.png`：画布上的结果
- 时间线：`.tmp/eval/meeting-timeline.jsonl`；CLI 调用记录：`.tmp/eval/trace.jsonl`（idempotency key 以 `mt-` 开头）
- 画布项目：`tX3xosH-WX9FeyZCX_MkU`（标题是截断的需求原文），最终版本 rev 28

## 10. 说明

- 评测环境的服务凭据不写入本文档；真实用户需在设置页填写自己的 RunningHub Key。
- 没有重启 agent 或 vite。评测期间只写了 `.tmp/eval/` 和本文件。
