# Flovart Adaptive Layout

> Current design after the container-driven Studio refactor (#15). 旧 CURRENT/TARGET/AUDIT 文档均为历史基线。

## 1. 当前结构

~~~text
app-shell
├─ top bar
└─ workspace
   └─ studio-layout
      ├─ studio surface
      │  ├─ Canvas
      │  ├─ Table
      │  └─ Agent connection page
      └─ Assistant drawer（仅 Canvas / Table）
~~~

布局责任由容器决定，不再由全局 viewport 宽度状态驱动。

## 2. 容器规则

- App shell 管顶栏与可用高度。
- Studio surface 管 Canvas / Table / Agent 的可用内容宽度。
- Workflow 自己拥有二维 pan/zoom；外围 chrome 才参与 reflow。
- Assistant drawer 桌面端参与布局，较窄容器可变成 overlay。
- Table 的 source rail / preview / tools 用 `clamp()` + container query 重排。
- 可复用组件优先按实际容器宽度适配，而不是猜设备型号。

## 3. 明确禁止回归

不恢复：

- `rightPanelInset` / `rightInset` 一类由 JS 计算画布留白；
- `workflow-toolbar--inset` 之类为了固定 drawer 宽度打补丁；
- 结构性 column 用 absolute positioning；
- 为每个像素 resize 更新 React 全局状态；
- 220px / 256px 等不可收缩结构列作为唯一布局；
- 同一 surface 多个互相争抢的页面级 scroll owner。

## 4. Scroll ownership

| Surface | Primary owner |
| --- | --- |
| Canvas | 二维 Workflow surface；侧栏/drawer 各自内部滚动 |
| Table | 当前媒体/工具内容区 |
| Agent | connection page 自身纵向滚动 |
| Assistant drawer | 当前 tab 内容 |
| Settings/Modal | dialog body |

Body 不承担 Studio 内部业务滚动。

## 5. 当前断点原则

断点只表达“容器是否还能容纳当前组合”，不代表手机/平板品牌。

- 宽容器：surface + docked drawer 可并排。
- 中等容器：次要区域收缩/堆叠，drawer 可 overlay。
- 窄容器：Table rail/tools 堆叠；顶栏 mode switch 可横向滚动。
- 短高度：压缩非核心 chrome，保留主操作可达。

## 6. 验证矩阵

至少覆盖 320–2560 CSS px 宽度、短高窗口、resize stress、drawer 开关、Canvas/Table/Agent 三个 surface，并验证：

- 无页面横向溢出；
- shell 占满可用高度；
- 主操作可达；
- 输入状态不因 resize 丢失；
- resize 不触发 Host discovery / Provider fetch / Workflow save；
- Canvas 坐标空间不被 UI inset 计算污染。

具体测试结果属于 evidence，不复制进本设计。
