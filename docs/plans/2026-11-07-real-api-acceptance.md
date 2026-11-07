# 真实 API 验收步骤（2026-11-07，草案）

目标：用自己的 Key 和素材，走一遍“导入素材 → 配置节点 → 计划卡 → 提交 → 查询 → 保存 → 播放 → 导出 → 刷新重读”。
本文档不写任何密钥；Key 只在设置弹窗里填写。

## 0. 准备

- Node >=22.19.0，仓库根目录执行 npm install。
- 启动：npm run flovart:cli -- start --source --web（或桌面端）。
- 准备 1 张参考图、可选 1 段参考视频（时长不超过模型上限，超限会在计划卡里被拦下）。

## 1. 配置服务（设置 → + 添加 AI 服务）

| 字段 | 填写 |
|---|---|
| 协议 | 按服务商选择（OpenAI 兼容等） |
| 请求地址 | 服务商 Base URL，一般以 /v1 结尾 |
| API Key | 自己的 Key |
| 这个 API 用于 | 只勾选服务商真正支持的能力。默认是“文本 + 图像”，只做视频时需勾选“视频”、取消不支持的项，否则验证会报“当前端点不支持：文本” |
| 模型列表 | 点“获取模型”或手动输入模型 ID |

点“验证并保存”，弹窗关闭即为成功。

## 2. 画布操作

1. 工作流视图导入参考图（拖入或上传）。
2. 新建视频节点，连上参考图，选模型、时长、分辨率、比例。
3. 点运行 → 计划卡：核对服务/模型、参数、每个参考的 ✓/!/✕、预估额度（标注“预估”，不是账单）。
4. 点“生成”。节点进入生成中，完成后可播放。
5. 导出结果；刷新页面后确认节点仍显示同一结果。

## 3. 必查项（填写结果）

| # | 场景 | 操作 | 期望 | 结果 |
|---|---|---|---|---|
| 1 | 正常成功 | 上述步骤 | 可播放、可导出、刷新后仍在；服务商后台只有 1 个任务 | |
| 2 | 超限引用 | 连一段超时长参考视频 | 计划卡“生成”灰掉，原因在该参考行；服务商无新任务 | |
| 3 | 取消计划卡 | 弹卡后点取消 | 服务商无新任务 | |
| 4 | 连续点击 | 快速连点运行 | 只弹一次卡、只提交一次 | |
| 5 | 中途刷新 | 生成中刷新页面 | 恢复时查询原任务，不重新提交 | |

提示：提交后服务商可能立即开始计费，中途停止或取消通常不退费，实际扣费以服务商账单为准。场景 4、5 会实际产生调用，建议用最短时长、最低分辨率。

## 4. 自动化对照（fake provider，不花钱）

```bash
FLOVART_CHROME_PATH=<chrome.exe> node scripts/e2e-provider-trace.mjs success   # 也可以 cancel / double / submit_lost / download_error / rate_limit / reload_mid / overlimit_ref / dsh_three_shot
```

输出在 `.tmp/e2e-trace/<scenario>.json` 与截图；`checks.http` 是 fake provider 实际收到的请求，`checks.expectations` 是本场景的判定。

## 5. 2026-11-07 fake provider 结果（未花钱，费用：未测量）

“浏览器 e2e”= 真实 Chromium + 真实 Provider HTTP 边界 + fake provider 请求日志；“单测”不经过浏览器。以下不等于真实服务商验收，仅用于对照。

| 场景 | 证据级别 | 结果 |
|---|---|---|
| success | 浏览器 e2e | 1 次 POST；成功、已保存、刷新后保留；video readyState 4 |
| overlimit_ref | 浏览器 e2e | 计划卡“暂时无法生成 · 当前 AI 服务最多接收 1 个 @图片 参考”，允许按钮禁用，拦截期间 0 次 POST；移除多余参考后 1 次 POST（含 `images`、`reference_roles`，1 个参考）成功。注意：此场景测的是参考数量上限，不是视频时长上限 |
| cancel | 浏览器 e2e | 0 次 POST，节点 idle |
| double | 浏览器 e2e | 1 次 POST，无第二张卡 |
| submit_lost | 浏览器 e2e | 1 次 POST；节点显示“提交结果未知…已禁止自动重试”，billableState=unknown |
| rate_limit | 浏览器 e2e | 1 次 POST；“AI 服务当前限流，请稍后重试”，不自动重试 |
| reload_mid | 浏览器 e2e | 1 次 POST；刷新后续查同一 task id 并成功 |
| download_error | 浏览器 e2e + 单测 | 下载失败保留 task id，重新下载不二次提交（`tests/providerSubmitSafety.test.ts`） |
| 保存写入失败 | 仅单测 | 存储写入失败发出持久化错误（`tests/workflowStore.test.ts`）；无浏览器场景 |
| 旧任务不覆盖 | 仅单测 | 停止后重跑不提交旧结果；运行中被替换的媒体保留，结果另建新节点（`tests/workflowGeneration.test.ts`） |
| dsh_three_shot | 浏览器 e2e（非 DSH Agent） | 一张批量卡、首轮 3 次 POST；只改镜头 2 后合计 4 次 |

残余风险：服务商或代理在零字节断开复用连接时，浏览器可能自行重发 POST，应用层无法阻止。验收时以服务商后台任务数为准。

## 6. 其他

- 真实 DSH 会话：按 `dsh-plugin/RELEASE.md` “真实 DSH 会话验证”执行（会产生付费 LLM 调用）。
- 无 Key 试用：首次进入的开始页（想做点什么？）或空画布点“打开示例画布（示例，免 Key）”；未配置 AI 服务时点运行会先弹“配置 AI 服务”引导。示例节点只靠标题“示例 · …”标注，没有单独的来源元数据。
