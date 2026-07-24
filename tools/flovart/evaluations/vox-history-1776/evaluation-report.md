# Flovart × VOX 风格短片真实评测

## 结论

本次真实 tracer-bullet 已跑通：用户只在 Flovart Desktop 保存一次 RunningHub API Key，Coding Agent 随后通过 Flovart CLI 完成选题、四段视频提交、持久任务监控、产物下载、本地旁白/字幕/混音/拼接与交付校验。

这证明当前系统已经能支撑**受控的单条风格化短片生产链**，但还不能宣称已经形成“任意第三方导演 Skill + 一个 Key = 稳定成片”的 UGC 制作平台。主要缺口是 Director Skill ABI、ProductionRun/Shot/Artifact 领域模型、统一后期命令、预算审批、远端取消和第三方 Skill 权限沙箱。

成片：[vox-history-1776.mp4](./vox-history-1776.mp4)

## 题材与事实边界

- 发现来源：[Reddit r/history all-time top](https://www.reddit.com/r/history/top/?t=all)
- 一手史料：[John Adams diary, 9 September 1776](https://founders.archives.gov/documents/Adams/01-03-02-0016-0187)
- 选题：1776 年，John Adams 与 Benjamin Franklin 在新不伦瑞克旅店共用一张小床，并围绕开窗、冷空气和污浊空气争论。
- 事实边界：Adams 后来承认 Franklin 关于污浊空气的论述“有很多道理”，但没有接受“冷空气不会导致感冒”的完整推论。

## 执行结果

使用 RunningHub 官方 `rhart-video-v3.1-lite-official/text-to-video` 路线，4 个 8 秒镜头全部成功。官方接口采用提交 `taskId` 后轮询查询的异步模式，并提供提交前价格预览；本次 Runtime 按该契约执行。[生成接口](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183147) · [任务查询](https://www.runninghub.cn/runninghub-api-doc-cn/api-425767306) · [价格预览](https://www.runninghub.cn/runninghub-api-doc-cn/api-454850620)

| 镜头 | Runtime taskId | Provider taskId | 耗时 | 预估价 | 结果 |
| --- | --- | --- | ---: | ---: | --- |
| 1 | `task_019f91f5-2b03-7410-b7d6-bf8451d21dde` | `2080480563089051649` | 7m 41.982s | ¥2.56 | 成功 |
| 2 | `task_019f91ff-1500-7171-adca-cfef42ecc306` | `2080483288782610433` | 1m 23.538s | ¥2.56 | 成功 |
| 3 | `task_019f9201-7e4d-7fd3-a5a4-5ebf296da9e0` | `2080483950962610177` | 1m 54.052s | ¥2.56 | 成功 |
| 4 | `task_019f9204-7e47-77a2-a273-5659a870da52` | `2080484776095408130` | 2m 25.265s | ¥2.56 | 成功 |

- 成功率：4/4
- 顺序生成总耗时：13m 24.837s
- 平均单镜头：约 3m 21s
- 提交前预估合计：¥10.24；这是价格预览，不等同于最终扣费，最终账单需以 RunningHub 控制台为准。
- API Key 仅由 Desktop 写入 Windows Credential Manager；CLI、任务参数、源码和报告均未接触或记录明文 Key。

## 成片验收

| 项目 | 结果 |
| --- | --- |
| 时长 | 30.000s |
| 画面 | 1280×720，24fps，H.264 |
| 音频 | AAC，48kHz，双声道 |
| 字幕 | 简体中文硬字幕 |
| 响度 | -16.1 LUFS，True Peak -1.5 dBFS |
| 校验 | 全部通过 |
| SHA-256 | `5ba3d0bc50a1016f305accf5ed9d6a1e08d36d1d6c392d6ddb1adcdc44c75de7` |

结构化校验结果见 [vox-history-1776.verify.json](./vox-history-1776.verify.json)。

## 视觉评测

- 镜头 1 的纸张拼贴、地图和版面感最接近目标，但模型违反了“无文字/无 Logo”约束，生成了 `VOX` 标识；成片阶段已用同色纸片遮盖。
- 镜头 2 没有品牌 Logo，但出现不可读的小型报纸文字，人物造型与镜头 1 有漂移。
- 镜头 3 是质量最佳镜头：蓝色新鲜空气、红色污浊空气和肺部图解形成了清楚的视觉解释。
- 镜头 4 的喜剧节奏成立：Franklin 仍在讲解，Adams 已经睡着，羽毛笔/日记页完成收束。
- 直接文生视频虽能交付，但跨镜头角色一致性和文字污染不稳定。`vox-director` 的“先做静态风格样张和关键帧，再图生视频”原则是正确方向，不能被便宜的直出路径替代。

## 对 `vox-director` 的判断

[`avabbbb/vox-director`](https://github.com/avabbbb/vox-director) 更适合被吸收为**创意导演模板**，不应直接成为 Flovart 的 Provider/Runtime 依赖：

- 可复用：beat map、style bake-off、关键帧、镜头动画、VO/音乐、最终合成等创作阶段。
- 需要改造：它当前绑定 Atlas Cloud 模型与环境变量 Key；Flovart 必须继续独占凭据保管、Provider 路由、任务账本和产物追踪。
- 生态成熟度有限：当前仓库是小型 fork、无正式 release；虽然采用 [MIT License](https://raw.githubusercontent.com/avabbbb/vox-director/main/LICENSE)，仍应通过 Flovart 自己的 Skill manifest 和权限模型接入。
- README 的安装示例仍指向原始仓库，而不是该 fork，发布完整性还不足以作为稳定依赖。

## 推荐架构

```text
Director Skill
  → Production Manifest（节拍、镜头、风格、人工 Gate、能力要求）
  → Flovart Orchestrator（校验、报价、预算策略、路线规划）
  → Production Runtime（凭据、幂等任务、事件、Provider 生命周期）
  → Artifact Graph（Shot / Take / Source / Derived / Delivery）
  → Post-production（旁白、字幕、混音、合成、校验）
  → Delivery Report
```

职责边界：

- Director Skill：创意意图、风格约束和工作流模板。
- Flovart Skill/Orchestrator：计划校验、预算、Provider 路由、监督与重试策略。
- CLI/Runtime：确定性副作用、Secret 保管、持久 Task/Event/Artifact。
- Coding Agent：创意规划、质量判断、异常恢复和人工 Gate 协调。

## 上线 UGC Skill 生态前的阻塞项

1. 定义版本化 Director Skill manifest：输入、输出、能力、权限、预算、人工 Gate、产物契约。
2. 建立 `ProductionRun → Shot → Take → Artifact → Delivery` 一等数据模型。
3. 把旁白、字幕、合成、响度和交付验证注册为持久 CLI/Runtime 命令。
4. 将 `quote → approve → submit` 分成明确状态，支持单次/整片预算上限。
5. 区分“停止本地等待”和“Provider 已确认取消”；当前本地 `task.cancel` 不能保证停止 RunningHub 远端计费。
6. 为第三方 Skill 增加签名、网络/Provider scope、Secret 隔离、文件权限和费用配额。
7. 先做风格样张与角色参考，再以 image-to-video 生成镜头；把跨镜头一致性变成可检查的 Gate。

## 最终判断

- “Coding Agent + Desktop 保存一个 API Key + Flovart CLI 完成 30 秒短片”：**本次已真实跑通**。
- “`vox-director` 与 Flovart Skill 能否配合”：**能，但应通过 Production Manifest 对接，不能直接共享 Key 或把 Provider 脚本塞进导演 Skill**。
- “是否已能承载开放 UGC 风格 Skill 生态”：**尚未**。下一步应优先做 `ProductionRun v1`，而不是继续堆更多 Provider 路由。
