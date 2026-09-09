# Flovart Responsive UI Audit

本审计以当前工作区代码为准，覆盖 `#/dock`、`#/app` 的 Workflow/Table/Agent 外壳、Settings、Onboarding 和可复用配置选择器。它补充了 `docs/design/responsive-ui/CURRENT_LAYOUT_AUDIT.md` 的早期 Agent/Dock 记录，不改变 Workflow、Provider、Agent authority 或 BYOK 数据语义。

## Findings

| Component | Current assumption | Failure width / height | Root cause | Strategy |
| --- | --- | --- | --- | --- |
| `AppShell` | 页面由 `h-screen`/Flex 和多个 `height: 100%` 子节点拼接 | `1024×600`、`768×500` | viewport 高度责任不集中，子节点的 intrinsic size 可能把滚动推出 shell | root 使用 `100dvh`、`min-width: 0`、`min-height: 0`；内容区拥有内部滚动 |
| `App.tsx` | App 监听每次 `resize` 并更新宽度状态 | 连续拖动窗口 | 宽度状态没有业务消费者，却会触发整棵应用重渲染 | 删除无消费者的 resize state；布局交给 CSS/container query |
| Dock rail / Bridge | rail 固定在左侧，Bridge 参与三列布局 | `<768px`、短高窗口 | 窄窗口仍被 rail/Bridge 占用；Bridge 与主内容没有自然 reflow | 宽屏三列；中屏 Bridge 下移；窄屏 rail 变为底部导航 |
| Connected Agent control | context 与 production scene 以固定 `280px/360px` 最小行堆叠 | `480×800`、`768×500` | 两个最小行高相加超过可用高度，内部滚动失去边界 | 两行均允许 `minmax(0, 1fr)`，内容在各自面板滚动 |
| Public Agent Link | setup surface 使用 `auto max-content auto` | 短高窗口、窄宿主面板 | 内容最大高度和容器高度没有明确滚动所有权 | surface 本身 `min-height: 0; overflow: auto`，卡片使用 container query |
| `ConfigSelector` | 两个横向 chip，弹层 `bottom-full` 且 `min-width: 200px` | `320–560px` 容器、屏幕边缘 | popup 依赖父级空间，长名称撑宽，缺少 focus/escape 语义 | 一个语义选择器，多种呈现；portal + flip/shift；窄屏 bottom sheet |
| Settings dialog | `max-height: 90vh`、header/tabs/actions 横向排列 | `390×844`、`768×500`、200% zoom | `vh` 在移动浏览器不稳定，操作区不能换行，modal body 没有稳定 flex scroll 边界 | `90dvh` flex dialog；tabs/action groups 可滚动/换行；body 唯一滚动区 |
| API service card/form | card actions 与 API key 操作区默认横排 | `<640px`、长 provider/model 名称 | action 区和 intrinsic width 没有 `min-width: 0`/wrap | card grid + action wrap；key row 在窄容器转为单列 |
| Onboarding | modal 已有部分 `dvh`，内容 padding 和底部 action 仍偏桌面 | `390×844`、短高窗口 | 底部按钮、输入 action 和大 padding 抢占可视高度 | dialog 使用 shell class；内容滚动，footer shrink/wrap，移动端取消不必要 autofocus |
| Table / Workflow chrome | Canvas 外围仍有固定列和 `100vh` 媒体高度 | `768px`、`320px` reflow | Canvas 二维空间与外围控件的布局责任混在一起 | Canvas 保留二维交互；toolbar/inspector/sidebar 在中窄尺寸 reflow 为 drawer/stack |

## Responsive architecture

```text
viewport (100dvh)
└── AppShell / DockPage (grid, min-height: 0)
    ├── navigation / topbar
    └── active surface (minmax(0, 1fr))
        ├── public Agent Link
        ├── Agent workspace
        ├── AI Services / Settings dialog
        └── local scroll owner for the active content
```

页面级结构使用少量 viewport breakpoints；可复用卡片和选择器使用 `container-type: inline-size`，因此同一个组件放入完整应用、Agent sidebar 或未来 creative-host panel 时不依赖外层 viewport。

## Validation matrix

目标窗口：`2560×1440`、`1920×1080`、`1600×900`、`1440×900`、`1366×768`、`1280×720`、`1024×768`、`820×1180`、`768×1024`、`640×900`、`480×800`、`430×932`、`390×844`、`360×800`；普通设置/表单另测 `320 CSS px`、200%/400% zoom，以及 `1280×600`、`1024×600`、`768×500`。

每个非 Canvas surface 需要满足：页面无横向溢出、shell 触达可用 viewport 底部、滚动发生在预期内容区、长名称不会撑破 grid/card/toolbar、弹层不越过 viewport；resize 过程中不重新请求、不丢输入状态。Agent→Workflow 的真实运行时演示另需 Flovart Link/browser binding 在线作为前置条件，不能用静态或概念动画代替。

## Runtime evidence

本轮检查 `npm run flovart:cli -- ensure --json` 返回 `LINK_OFFLINE`（frontend/agent ready，browser offline），因此当前不能把真实 Agent 修改 Workflow 的过程标记为已录制或已通过。响应式 UI 可以在 Vite 页面和 mock crew 连接上验收；真实 Hero proof 待 Link 恢复后再录制。
