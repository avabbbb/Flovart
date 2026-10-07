# 模块：Creative Hosts

> 状态：**Current truth**。总纲见[总体设计](00-overview.md)，交互见[交互设计](01-interaction.md) §6.1。Resolve 面板的像素级规格见 [Resolve 21.1 Product & UI Spec](../../integrations/studio/resolve/PRODUCT_UI_SPEC.md)（本模块的实现附录，产品决策以本文为准）。

## 1. 职责

把 Iris 带进用户已经在用的创作软件：读取当前选择 → 生成叠加层候选 → 非破坏性送回宿主。宿主扩展只是投影，不建立第二套 Workflow、Provider、任务或素材系统。

## 2. 宿主优先级

| 宿主 | 第一控制面 | Iris 部分 | 状态 |
| --- | --- | --- | --- |
| **Resolve Studio 21.1** | Blackmagic native MCP（Agent 宿主操作） | Workflow Integration 轻面板（人审核面）；OFX 后置 | 第一宿主，Experimental |
| After Effects | CEP / ExtendScript 面板 | C++ Effect SDK 源码保留 | Experimental，暂停扩张 |
| Premiere Pro | UXP | 原生效果后续单独验证 | Experimental |
| Photoshop | UXP | C++ Filter SDK 后续 | Experimental |

Resolve 纵向切片跑通前，AE / PR / PS 不再扩张，只在共享修复时改动。

## 3. Resolve 产品流程

~~~text
Setup AI Assistants → 真实 Agent 已连接 → 选择片段
→ Agent / 面板读取上下文（冻结目标）
→ Layer（可选 Draw）→ Plan → 生成 N 个叠加层候选
→ 候选网格比较 → 选定 → Add to Media Pool（P0）
→ Add to new track（P1）→ 开关对比 / 删除即撤销
→ Replace / Commit（P2，显式确认、可恢复）
~~~

### 3.1 面板结构（自上而下）

Agent 活动条（仅 Agent 工作时）→ Connection → Current Clip → Tools → Generate（Prompt + References）→ Model（默认 Auto）→ Output → Task → Candidates（网格）→ Open in Iris。

- Tools 来自工具注册表 × 宿主能力探测：P0 只开放 Layer、Draw；Restyle / Key / Reframe / Upscale 在能力未就绪时不显示可点按钮。
- Output 选项由能力探测生成：P0 只有 Media Pool；探测确认能建轨道、按起始帧放置、切换启用后才出现 “New track”。
- 视觉以 Resolve Inspector 为准：紧凑单列、弱品牌、一个主 CTA、跟随宿主主题。

### 3.2 叠加层（Layer）

- Draw：当前帧画区域 → 单帧遮罩 → 作为 Reference。逐帧跟踪是后续能力，未测前不宣称。
- 产物：与源片段同帧率、同时长、同尺寸的 RGBA 序列（或宿主可读的带 Alpha 视频），记录预乘方式，不含源像素。
- 候选数量来自 schema（默认值可配置），提交前显示合计费用；未选中的候选留在 Media Pool 的 Iris bin。
- 上新轨道：放在源轨道正上方，入出点对齐；源轨道全程只读；开关 = 轨道 / 片段启用；撤销 = 删除新轨道上的片段。
- **假设**：Resolve 21.1 的 native MCP 或 Scripting API 能新建轨道、按 record frame 追加、切换启用。必须本机核实并记录 gap；做不到时退化为“导入 Media Pool + 拖放提示”。

### 3.3 安全与并发

- 任务冻结 project / timeline / clip 身份；用户切换选择不改变执行目标。
- 默认只用 native MCP 的 bounded 执行面；unsafe 文件 / 网络 escape 默认拒绝。
- 未检测到 Studio 21.1、无项目、无选择、MCP 未连接、Iris 未连接时，各显示一个恢复动作，不暴露端口、Lease、MCP JSON、Token。
- Windows CJK / Python UTF-8 问题先本机复现再处理，不预先写入社区 workaround。

## 4. 原生效果（AE / PR / PS / OFX）

- 效果只读取固定素材版本渲染：不联网、不等待模型、不依赖 Agent 或 Iris 在线。
- 多帧渲染不共享可变“当前帧”；按宿主 SDK 线程规则实现。
- 已有 AE 源码事实（Experimental）：按 Artifact ID + SHA-256 命名本机素材；候选图层默认关闭可见，应用才生效；导入后记录帧率、像素宽高比、Alpha、项目色彩；写盘回读校验后原子重命名。
- 未证明：已编译 `.aex`、MFR 并发、输出范围 / 偏移、缺失重定位、工程自包含、真实宿主认证。

## 5. 当前源码与缺口

| 位置 | 内容 |
| --- | --- |
| `integrations/studio/resolve/` | Inspector 面板（中英文）、候选导入状态、Electron userData 内容寻址存储 |
| `integrations/studio/shared/`、`services/studio/` | 共享 adapter 与 `StudioWorkflowController` |
| `integrations/studio/after-effects/` | CEP 面板与 C++ 效果源码 |

缺口：面板生产 controller 注入未验证（`installStudioBrowserLink()` 只有测试调用）；`Open in Iris` 未传 workflow / task / artifact / target；Resolve 导入后是否复制媒体未验证；本机 Resolve 版本为 21.0，非目标 21.1。

## 6. 验证

真实宿主认证至少覆盖：安装、选择 / 目标绑定、生成 / 导入、取消 / 失败、保存重开、素材缺失、离线导出；叠加层另需：开关后原片逐像素一致、对齐误差 0 帧、Alpha 边缘无黑白边。各宿主清单：`integrations/studio/*_REAL_HOST_CHECKLIST.md`。
