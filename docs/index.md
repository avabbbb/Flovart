# Flovart 文档地图

四类：**current truth**（当前产品与系统的唯一依据）→ **提案**（未接受）→ **指南与记录**（使用、进度、开发日志）→ **归档**（只读历史）。支持等级只看 [SUPPORT_MATRIX](../SUPPORT_MATRIX.md)；AI / 自动化开发约束见 [AGENTS.md](../AGENTS.md)。

产品地图：顶栏 **画布 Canvas**（GenAI 生成与 Workflow 基本盘）｜**逆向 Reverse**（全能助手：强模型把电脑与画布当工具、多 Agent 协作；逆向拆解是其工具）｜**Agent**（Agent 连接与状态管理）。详见 [00](design/00-overview.md) §3.1。

## 1. Current truth（`docs/design/`，共 11 份，上限 12，见 AGENTS.md §9）

| 文档 | 内容 |
| --- | --- |
| [00 总体设计](design/00-overview.md) | 产品一句话、三个 surface 与交接、原则、关键决策、状态归属、路线图、对外口径、术语 |
| [01 交互设计](design/01-interaction.md) | 交互与行为：三条总规则、状态模型、核心流程、产品地图、逆向全能助手工作区（prompt 首页、多 Agent 光标、飞入组装、trace 同步、预览、版本对比）、Canvas 交互、run / trace、参考先行、交互模式、参考表；[可点击原型](design/prototypes/index.html) |
| [DESIGN.md](design/DESIGN.md) | 视觉与动效 token（Refero 式分层）：mood、颜色、字体、按钮、图标、间距、层级与玻璃、圆角、组件、底层逻辑、Do & Don't、动效（三档弹簧） |
| [10 Canvas / Workflow](design/10-canvas-workflow.md) | 可见生产图、mutation、素材语义、分镜 / 锚点 / 拼接等制作机制 |
| [11 Reverse](design/11-reverse.md) | 逆向 = 全能助手的定位；Hypit 架构复刻的逆向拆解（作为工具与面板）、转为 Canvas 子画布 |
| [12 Agent](design/12-agent.md) | Skill + CLI、MCP 投影、Agent 连接与状态中心、内置 Agent 的放置、安全边界 |
| [13 Generation & Runtime](design/13-generation-runtime.md) | 一条生成路径、Provider 路由、任务与计划卡、素材版本、流式与媒体用量 |
| [14 Creative Hosts](design/14-creative-hosts.md) | Resolve 首发、叠加层、上轨道、原生效果 |
| [15 Web, Community & Extension](design/15-web-community-extension.md) | 网站后端、社区、浏览器导入、发行 |
| [20 质量与治理](design/20-quality-and-governance.md) | 证据分级、评测、文档结构与规则 |

实现附录（在代码目录内）：[Resolve 21.1 Product & UI Spec](../integrations/studio/resolve/PRODUCT_UI_SPEC.md)、[Studio host packages](../integrations/studio/README.md) 与各宿主 `*_REAL_HOST_CHECKLIST.md`、[Workflow CLI](../skills/flovart/commands/workflow.md)、[后端响应](content/docs/backend/api-response.mdx) / [数据库结构](content/docs/backend/backend-database.mdx)。

## 2. 提案（PROPOSAL / 进行中的计划，不是 current truth）

| 文档 | 内容 |
| --- | --- |
| [16 Agent 视频流水线](design/16-agent-video-pipeline.md) | 宣传片流水线能力矩阵、工具集、run / trace 模型、素材归档、放置（2026-11-13 改为逆向 = 全能助手主场）、P0–P2 计划与验收 |
| [DSH 工作台计划](plans/dsh-workbench.md) | Flovart 作为 DeepSeek Harness 工作台、DSH Agent 通过工具操作画布（草案） |

## 3. 指南与记录

使用指南：
- [快速开始](overview/quick-start.md) / [Getting Started](overview/quick-start.en.md)
- [Windows 安装](overview/installation.zh-CN.md)
- [Agent Skill 使用](overview/skill-guide.md)
- [新用户操作手册](overview/user-manual.zh-CN.md)

进度（对外页面）：
- [当前功能](content/docs/overview/features.mdx) / [Features](content/docs/overview/features.en.mdx)
- [后续待办](content/docs/progress/todo.mdx)
- [待测试确认](content/docs/progress/pending-test.mdx)

质量与开发日志：
- [真实 API 验收步骤](quality/real-api-acceptance.md)：导入 → 计划卡 → 提交 → 查询 → 保存 → 播放 → 导出 → 刷新重读
- [2026-11-12 Agent / 工具链迭代 · 第二份](quality/2026-11-12-agent-tool-eval-2.md)
- [2026-11-11 Agent / 工具链迭代](quality/2026-11-11-agent-tool-eval.md)
- [2026-11-03 浏览器插件 × 网页画布](blog/2026-11-03-extension-web-canvas-bridge.md)

法律：[隐私政策](PRIVACY_POLICY.md) / [中文](PRIVACY_POLICY.zh-CN.md)、[服务条款](TERMS_OF_SERVICE.md) / [中文](TERMS_OF_SERVICE.zh-CN.md)。

## 4. 归档（只读）

- [2026-11-13 设计语言与文档树清理](archive/2026-11-13-design-refresh/)：原 30 竞品机制复刻、31 Notion 式紧凑 UI、32 流式用量（蒸馏进 10 / DESIGN.md / 13）；LibTV 对标两份、计划卡设计稿（已实施）、0.3.0 内测清单、DSH 表单文案、沉浸式翻译调研、面试演示场景。逐份原因见该目录 README。
- [2026-10-19](archive/2026-10-19/)：Beta 评估。
- [2026-10-07 重构归档](archive/2026-10-07/)：旧主设计、ADR、开发契约、品牌迁移、维护资料、RC 证据。
- [更早的归档](archive/)

历史文档、旧报告与 Git 历史只解释“当时为什么”，不能推翻上面的 current truth。
