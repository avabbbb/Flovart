# Flovart Responsive UI：当前布局审计

本审计对应的入口是 `#/dock`，以及主应用 `#/app` 切换到 Agent 后的工作区。目标是修复真实窗口中的“主体只占上半段、底部黑区、固定三栏和技术配对字段首屏暴露”，同时保留现有 Agent bootstrap、Browser Workflow authority、Provider pipeline 与 Workflow/Table/Agent 分层。

## 旧布局审计

| Component | Current sizing model（修改前） | Problem | Affected viewport | Proposed fix |
| --- | --- | --- | --- | --- |
| `AppShell` | 根节点使用 `w-screen h-screen flex flex-col overflow-hidden`；顶部、`OfflineNotice` 和内容区是连续 flex 子项；`html/body/#root` 只有 `min-height: 100%`。 | Shell 没有明确拥有动态 viewport 高度，离线提示会参与 flex 高度分配；下游 `height: 100%` 只能依赖不稳定的父级高度，短窗口容易出现内容未填满或剩余空区。 | 所有短高窗口，尤其 `1366×768`、`1280×720`、`1024×600`。 | 使用 `height: 100dvh`、`min-height: 0` 和 `grid-template-rows: auto minmax(0, 1fr)`；把 offline 行与 workspace 内容放入同一 shell，并由内容区决定内部滚动。 |
| `DockPage` | `grid-template-columns: 64px minmax(0, 1fr)`、`height: 100%`；右侧 `.dock-bridge` 是 `position: absolute`、`width: 240px`、`top/right/bottom: 0`。 | Bridge 不参与主布局，主内容不知道它占用的空间；固定 240px 在窄窗口压缩中心内容，绝对定位也掩盖了横向溢出的来源。 | `1280px` 以下、Bridge 打开时的 `1024px`、Tablet 和窄 Panel。 | 用 Grid 第三列 `minmax(280px, clamp(280px, 24vw, 360px))`；`760px` 以下将 Bridge reflow 到底部，列表自己滚动。 |
| `ProductionControl` 未连接态 | `.agent-studio` 的两列结构把 URL/Token 表单放在左侧，把“配对顺序”说明放在另一列；表单和说明随页面一起首屏展示。 | 普通用户先看到工程配对流程，而不是当前状态和主操作；中间栏信息密度低，窗口缩放后继续占用结构空间。 | 全桌面宽度；`1280×720` 截图中尤为明显。 | 改成 `agent-link-surface`：当前状态与主 CTA + 其他 Agent 两块卡片；手工 URL/Token 与 diagnostics 放进折叠 Advanced。 |
| `AgentWorkspace` | JSX 内联 `minmax(220px, ratio%) minmax(400px, ratio%)`；ratio 写入 localStorage；separator 用 absolute `left: calc(...)` 监听 `pointermove`。 | 页面级百分比和 400px 最小列把布局绑定到历史比例；separator 是结构的一部分却不参与 Grid，窄屏还需要额外 JS resize 状态。 | `1024px` 以下、`768px`、`640px`、`480px` 和未来侧栏容器。 | 使用语义化 `.agent-workspace-shell` Grid；`minmax(0, 1fr)` + `minmax(280px, 360px)`，`1023px` 以下单列；移除绝对 separator 和逐像素 resize listener。 |
| `AgentHostPicker` | 原状态卡同时承载 Host label、writer、projection、activation 和连接实现信息。 | 普通用户需要理解 Host 写入权、Projection、Writer 等内部架构词；卡片不能在不同宿主容器中独立调整。 | 完整 App、Dock、未来 Creative Host Panel。 | 公开层只展示 Agent、四态 status 和 Use/Setup CTA；用 `container-type: inline-size` 与 `@container` 适配实际容器；`AgentHostDiagnostics` 单独承载 diagnostics。 |
| `styles/workflow.css` 的 `.agent-studio` | `grid-template-columns: minmax(230px, 36%) minmax(420px, 64%)`、`height: 100%`；`max-width: 900px` 时隐藏 context。 | 最小列和百分比同时存在，导致可用空间不足时布局突然挤压或直接隐藏主要上下文；与 Dock 自己的布局模型重复。 | `1366×768` 以下，以及窄宿主面板。 | 新公共 Agent shell 负责 setup/picker；连接后的制作控制只复用流体 Grid，并在 `760px/560px` 处堆叠。 |
| 全局根节点与 workspace | 部分页面依赖 `height: 100%`，部分页面使用 `100vh`，滚动容器没有统一的 `min-height: 0` 约束。 | viewport、header、workspace 的高度责任不清晰；一个内部面板的最小内容高度可能把滚动推到 body，表现为底部黑区或整页滚动。 | `1920×1080` 到 `390×844` 的全部高度组合，短高窗口风险最高。 | 根层统一 `100dvh`；shell、workspace、main 都允许收缩；每个表面只在自身内容区滚动。 |

## 修改后的布局责任

```text
viewport (100dvh)
└── AppShell / DockPage (grid, min-height: 0)
    ├── navigation / topbar
    └── workspace (minmax(0, 1fr))
        ├── public Agent surface
        ├── Agent workspace
        └── local scroll container owned by the active surface
```

页面结构只使用 Grid/Flex、`minmax()`、`clamp()` 和 container queries。绝对定位仍可用于 badge、overlay 或 hit target，但不再用于页面列、separator 或 Bridge 的结构定位。

## 运行时边界

- 连接成功、Host discovery、Host activation、Workflow apply/run 和 Browser authority 没有更换实现；本轮只更换呈现层和布局约束。
- Manual connection 仍保留 `Agent 地址`、`Token`、连接和脱敏 diagnostics，但默认折叠，只有 Developer connection 展开后可见。
- Agent、Workflow、Table 仍是三个独立产品表面；App Shell 改动不把 Table 节点或 Provider 执行逻辑移入 Agent。

## 验证矩阵

真实 Chromium 检查覆盖 `2560×1440`、`1920×1080`、`1600×900`、`1366×768`、`1280×720`、`1024×768`、`768×1024`、`640×900`、`480×800`、`390×844`，并额外覆盖 Dock Bridge 打开、`#/app` Agent 工作区和不刷新 resize stress。每个尺寸检查 `document.documentElement.scrollWidth <= innerWidth` 与 shell 底部到达 viewport 底部。
