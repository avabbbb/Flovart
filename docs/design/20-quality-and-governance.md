# 质量、证据与文档治理

> 状态：**Current truth**。

## 1. 证据分级

| 等级 | 含义 | 来源 |
| --- | --- | --- |
| 已实现 | 代码在主干 | 代码与测试 |
| 已验证 | 真实环境通过 | [SUPPORT_MATRIX](../../SUPPORT_MATRIX.md) 唯一升级入口 |
| 设计目标 | 未实现 | 本目录设计文档、todo |
| 假设 | 需真实环境确认 | 文档中显式标注 |

构建通过、mock 通过、manifest 存在都不等于真实宿主 / 账号已认证。Fake Provider 只证明协议。

## 2. 测试匹配风险

- 文档改动：`npm run docs:check`（命令须在注册表中、Skill 投影不漂移、公开文档版本一致）+ 链接检查。
- 代码改动：相关 Vitest；Runtime：`cargo test`；浏览器：Chrome for Testing + 动态隔离端口。
- 宿主 / 原生效果：必须进真实应用。
- 临时文件放 `.tmp/` 或 `artifacts/`。

## 3. 评测集（建议目标，初始全部“未测”）

- 12 个获授权 5 秒 1080p 24fps SDR 片段：静物、人物运动、遮挡 / 细边缘、镜头运动各 3。
- 4 个可人工计算的合成序列（Alpha、帧号、关键帧、混合像素）。

| 类别 | 建议通过线 |
| --- | --- |
| 宿主正确性 | 8-bit 每通道误差 ≤ 1；无错帧、Alpha 黑边 |
| 叠加层 | 关闭叠加层时与原片逐像素一致；对齐 0 帧误差 |
| 持久性 | 12/12 保存重开、断网导出不产生生成请求 |
| 幂等与恢复 | 双击、断连、回执丢失、进程中断、晚到结果各 5 次，无重复提交或跨目标写入 |
| 交互无死锁 | 每个状态有出口；断 Agent / 断网 / 关面板后可恢复（见交互设计 §10） |
| 生成质量 | ≥ 10/12 样例多数尝试可用；双人评分平均 ≥ 4 |
| Agent 成功率 | 20 个固定任务 ≥ 18/20；错误目标 / 越权费用 / 假成功为 0 |
| 首次使用 | 5 名新用户 ≥ 4/5 无开发者介入完成 |

每次运行保存机器可读结果（提交、构建、OS / GPU、宿主 / SDK / 模型版本、输入 hash、参数、次数、冷 / 热 p50 / p95、成本、失败样例）。原始记录放 `artifacts/`，真实 Key 不进证据。

## 4. 文档治理

### 4.1 结构（上限 10 份设计文档）

~~~text
docs/
├─ index.md                  入口
├─ design/                   设计（≤ 10 份）
│  ├─ 00-overview.md         总体设计
│  ├─ 01-interaction.md      交互设计
│  ├─ 10–15 模块文档          每个模块一份
│  └─ 20-quality-and-governance.md
├─ overview/                 用户指南（快速开始、安装、Skill）
├─ content/docs/             对外页面：features、todo、pending-test、backend 参考
├─ archive/                  历史，只读
└─ 法律文本                   PRIVACY / TERMS
~~~

### 4.2 规则

- 产品变化改 `00-overview`；交互变化改 `01-interaction`；模块变化改对应模块文档。不新增并列的 CURRENT / TARGET / AUDIT / GOAL / HANDOFF 文档。
- 新模块出现时新增一份模块文档；设计文档总数超过 10 份时先合并。
- 提案标注 **PROPOSAL**，接受后蒸馏进设计文档，再归档提案。
- `todo` 只放未完成；已实现待验证移到 `pending-test`；验证后更新 features 与 Support Matrix。
- 历史文档、旧报告、Git 历史只解释“当时为什么”，不能推翻当前设计。
- README 保持结果优先，严格跟随 Support Matrix。
- 宿主实现细节（如 Resolve UI Spec、真实宿主清单）放在 `integrations/` 对应目录，作为模块文档的附录。

### 4.3 归档

2026-10-07 重构归档的原文在 [archive/2026-10-07](../archive/2026-10-07/)：旧主设计、Agent Integration、Adaptive Layout、产品叙事提案、ADR、开发契约、品牌迁移、维护资料、RC 证据。其中仍有效的内容已蒸馏进本目录。
