# Flovart Adaptive UI System — Surface Inventory

本清单以当前 React/Tauri/Web 工作区为边界，布局层改造不改变 Workflow、Table、Provider 或 Agent 的业务权威。所有表面共享同一套 CSS token 和滚动责任；可复用卡片优先按容器尺寸重排。

| Surface | Current layout | Fixed assumption / debt | Small-screen risk | Priority |
| --- | --- | --- | --- | --- |
| AppShell / StudioTopMenu | shell + top bar + active workspace | 根层仍同时出现 `100vh` 与局部 `h-screen`，顶栏和内容高度责任分散 | 短高窗口底部空区、工作区被挤出 | P0 |
| Workflow workspace | 无限二维画布，左侧浮层、底部 toolbar、右侧 drawer | right drawer 初始宽度读取 `window.innerWidth`；sidebar/drawer 通过绝对定位覆盖画布 | 320–1024px 三栏无法同时保留 | P0 |
| Workflow sidebar / Asset Browser | layers/assets tabs，浮层面板 | 面板宽度来自 JSX inline clamp；窄容器的工具菜单仍读取 viewport | 文本、批量动作和菜单越界 | P0 |
| Workflow right drawer / Inspector | absolute drawer + resizable separator | inline `minWidth/maxWidth` 依赖 viewport 计算；移动端仍保留桌面拖拽语义 | 面板覆盖主操作、触控难以调整 | P0 |
| PromptBar / node prompt | canvas overlay + chips + controls | overlay 位置由画布坐标计算，工具和引用 chip 需要独立溢出边界 | 输入区压缩、chip 撑出页面 | P0 |
| Table workspace | source rail + preview + processing tools | JSX 使用固定 `220px/256px` utility，媒体高度使用 `100vh` 语义 | 640px 以下工具区不可用 | P0 |
| Agent workspace | context + conversation，compact tabs | 已有 container query，但仍有页面级固定最小高度和 legacy workflow agent CSS | 嵌入 280–600px 面板出现双列/双滚动 | P1 |
| Agent Link / Host Picker | public setup cards + advanced details | 需保证卡片在宿主容器而非 viewport 下重排 | 长诊断和 CTA 折叠后不可见 | P1 |
| Settings / API services | dialog + tabs + provider cards | SettingsPanel 体量大，部分 grid/action 仍由 Tailwind 桌面列控制 | 320px 无法完成 URL → Key → Test → Save | P0 |
| Provider model / route mapping | form grids、pricing rows、route rows | 复杂行需要 container-aware card reflow | 横向滚动隐藏保存/删除 | P0 |
| Onboarding | modal wizard | 旧入口含固定 viewport 高度与大 padding 假设 | 短高窗口 CTA 离开视口 | P1 |
| Modals / dialogs | fixed overlay + panel | AssetAddModal、媒体预览等存在固定 max width/height | 320px 双向滚动或无法关闭 | P0 |
| Popover / menu | anchored absolute/fixed surfaces | 个别菜单用 `window.innerWidth/Height` clamp | 屏幕边缘越界 | P1 |
| Home / Community / Enterprise | page shells、cards、tables | 页面级 `100vw/100vh` 和固定 hero/card grids | 嵌入 panel 或窄窗口横溢 | P1 |
| Tauri / extension / host panels | 同一 React surface 的不同宿主 | 不能假设浏览器 viewport 等于宿主 panel | 280–600px 容器布局不一致 | P1 |

## 关键状态边界

- Canvas 保留二维 pan/zoom；外围 toolbar、sidebar、inspector、PromptBar 必须 reflow。
- Workflow、Table、Agent 仍是独立表面；响应式层不复制业务组件树。
- 面板开关、选中节点、表单草稿和当前 tab 在 resize 时保持不变。
