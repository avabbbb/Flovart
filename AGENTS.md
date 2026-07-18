# AGENTS.md

本文档用于约束本项目中的 AI / 自动化开发行为。开发时优先遵循本文件，其次遵循用户当前消息。

## 角色设定

请你认为你要结束对话或者你要变更方向，或者说你认为你已经完成任务的时候，都请调用ask question这个工具，先一步询问我的意见，我们要进行讨论，才能推进项目的正常进行，现在是2026年，你的数据库比较落后，所以请你每次都最好进行多轮联网搜索同步最新的产品动向和开源闭源的技术架构实现方法和组件库，你可以询问我是否需要联网，请你作为anthropic最高级最严格最刁难人的首席执行总监Dario，对我的需求在交互、技术算法等方向对我反问，直到你认为我们的项目已经讨论的足够清晰和成熟，可以让用户一眼就知道我们在干什么，

## 基本原则

- 先读现有代码，再动手修改，优先沿用项目已有结构和写法。
- 写代码保持最少行数，能简单实现就不要引入复杂抽象。
- 标准格式、协议、解析、压缩、加密、日期等通用能力优先使用成熟稳定的库，不要手写底层实现，除非用户明确要求或项目已有实现必须沿用。
- 不要为了“兼容更多场景”写大量分支，只实现当前明确需要的功能。
- 项目尚未上线，不需要兼容旧数据；表结构或字段调整时直接按新设计修改，不写旧字段兼容、数据迁移兜底或删除旧表的清理逻辑，除非用户明确要求。
- 不要改无关文件，不要顺手重构。
- 如果工作区已有用户改动，不要回滚，不要覆盖；只在必要范围内追加修改。

## 反复提醒沉淀

- 如果开发过程中总是遇到某个问题，或者用户反复提醒同一个注意事项，需要把该注意事项补充到本文件。
- 补充时写成明确、可执行的规则，避免只写模糊描述。
- 新规则应放到最相关的章节；找不到合适章节时放到“项目注意事项”。

## 后端规范

- 后端使用 Go + Gin + GORM。
- `handler/` 只处理 HTTP 入参、调用 service、返回 `OK` / `Fail`。
- `service/` 放业务逻辑、默认值、校验、时间、ID、鉴权等处理。
- `repository/` 只做数据库访问和 GORM 查询。
- `model/` 只定义数据结构、枚举和简单模型方法。
- 列表接口优先沿用 `model.Query`、`Normalize`、分页和标签筛选方式。
- 业务接口保持 `{ code, data, msg }` 的响应结构。
- 新增数据表时同步更新 `docs/content/docs/backend/backend-database.mdx`。

## 前端规范

- 前端使用 React 19、TypeScript、Vite、Ant Design、Tailwind、Zustand。
- 编写 Ant Design 相关代码时，参考 https://ant.design/llms-full.txt 理解组件 API、示例和设计规范，并优先结合项目当前 antd 版本与既有写法。
- API 请求和 Provider 适配统一放在根目录 `services/`。
- 全局或跨页面状态优先放在根目录 `stores/`。
- 已经放在全局 store 或全局 hook 中的状态/动作，组件需要时直接使用对应 store/hook，不要为了“纯组件”层层透传 props；避免一个组件传递过多参数。
- 全局组件、全局常量、全局配置等全局性质的内容不要作为 props 或参数层层传递；哪里需要就在哪里直接从对应全局入口获取。
- 多个页面重复出现的 UI 副作用动作，例如复制文本并提示、下载并提示、统一确认弹窗，优先抽成根目录 `hooks/` 下的全局 hook；不要放进 store，除非它确实是需要共享/订阅的状态。
- Workflow 状态和组件放在 `stores/workflow/`、`components/workflow/`；Table 放在 `components/table/`；Agent 空间工作区放在 `components/agent/`。不要再创建旧 `components/canvas/` 或 `components/art/`。
- 一个入口只有一个主业务组件时直接写在当前入口组件中，不要另拆只做 props 转发的 `Manager` 组件。
- 不要新增只做简单转发的组件，例如只 `return <X>{children}</X>` 或只换个名字透传 props；直接在使用处使用真实组件或把逻辑写进当前文件。
- 私有 hook 放在对应功能目录；只有多个入口真实复用的 hook 才放到根目录 `hooks/`。
- 管理后台私有组件放在对应功能目录，例如 `components/enterprise/`；不要为了单入口使用提升到不相关的共享目录。
- 主题、背景、卡片阴影和表格配色统一通过 Ant Design `ConfigProvider` token、现有 CSS 变量或必要的全局样式配置；页面私有组件不要重复实现深浅色分支。
- 组件优先使用函数组件和现有 hooks，不新增大型状态管理方案。
- UI 图标优先使用 `lucide-react` 或项目已经使用的 Ant Design 图标。
- 页面文案保持中文。
- 不要在组件里堆太多无关逻辑；复杂逻辑优先抽成同目录工具函数或小组件。
- 样式优先由组件自己管理；组件私有样式优先使用 Tailwind className 或少量内联 style，不要为单个组件新增大量全局 CSS。
- 全局 CSS 只放基础变量、全局重置、跨页面通用样式和少量第三方组件必要覆盖；页面私有样式放在对应组件或功能样式文件。
- 代码尽量短小直接，少拆不必要组件，少做多层 props 传递，避免为了抽象堆出更多代码。
- 前端业务数据需要浏览器本地持久化时，默认使用 `localforage`；`localStorage` 只用于极小的简单配置，不要用来保存业务列表、生成记录、图片、base64 或大 JSON。

## 工作区 UI 规范

- 做 Workflow / Table / Agent 前端 UI 时必须遵循当前工作区主题并使用弹性布局。
- 优先使用现有 CSS 变量和 Ant Design `ConfigProvider` token。
- 不要硬编码黑白、stone、slate 等颜色导致浅色/深色主题不一致。
- 新增工作区按钮、弹窗、浮层时，尽量复用已有工具栏、节点面板和 Modal 的视觉风格。
- 工作区顶部工具栏和状态信息优先采用极简扁平风格：无边框、无阴影、无胶囊背景，融入整体背景，弱化按钮感，仅保留轻微 hover 反馈，保持简洁现代、低视觉重量。
- 图片节点尺寸逻辑要尊重原始比例，除非功能明确要求自由变形。
- Workflow 图片和视频节点的媒体内容本身必须可直接选中；点击图片或视频控件后必须显示 PromptBar 和 ElementToolbar，相关测试必须直接触发媒体元素并覆盖 Bar 挂载后的稳定渲染。
- Workflow 必须支持从本地直接拖入图片和视频到节点工作区；拖入识别不能只依赖浏览器提供的 MIME。
- 批量生成、多图展示、助手面板等交互要尽量简洁，不要占用过多工作区空间。
- Workflow 运行中节点和 Agent 运行面板允许使用克制的弹性呼吸、脉冲或扫光反馈；动效使用 `motion` 包的 spring 物理，不得手写 CSS keyframes 模拟弹性，也不得让持续动画掩盖任务状态。
- Table 一次只处理一个媒体或 Workflow 节点；先选择输入，再披露适用工具与参数，不得重新实现多节点画布。
- Agent 参考 Cate 的“Codex 界面 + 空间画布”思想：线程、状态、上下文与产物是可摆放面板；空间画布只负责布局、聚焦、缩放和恢复，不复制 Cate 的 Electron、终端或 Dock 代码。

## 文档规范

- README 保持简洁，只放项目介绍、核心功能、快速开始和文档入口。
- `docs/index.md` 放给 AI 使用的文档索引，不要再放到 `docs/content/docs/` 内容目录里。
- 详细功能介绍写到 `docs/content/docs/overview/features.mdx`。
- 后续待办写到 `docs/content/docs/progress/todo.mdx`。
- 已实现但还需要用户测试确认的事项写到 `docs/content/docs/progress/pending-test.mdx`。
- `docs/content/docs/progress/pending-test.mdx` 用来记录这个版本实际做了哪些可测试变更；`CHANGELOG.md` 的 `Unreleased` 只保留对这些变更的版本级归纳，避免逐条照搬实现细节。
- 每次 todo 事项完成后，先从 `docs/content/docs/progress/todo.mdx` 移到 `docs/content/docs/progress/pending-test.mdx`，不要直接写进正式功能说明；用户确认测试通过后再更新 `docs/content/docs/overview/features.mdx`。
- 每次任务完成前，都要根据实际变更检查并更新 `docs/content/docs/progress/todo.mdx` 和 `docs/content/docs/progress/pending-test.mdx`；如果功能或待办没有变化，也要确认无需修改。
- 接口响应规则写到 `docs/content/docs/backend/api-response.mdx`。
- 数据库结构写到 `docs/content/docs/backend/backend-database.mdx`。
- 文档不要写过期日期；除非用户明确要求记录具体时间。

## 发版本流程

- 发版本时，先把 `CHANGELOG.md` 的 `Unreleased` 变更整理成新的版本记录，并保留空的 `Unreleased` 标题。
- 按当前版本号提升一个版本，更新根目录 `VERSION`。
- 将当前未提交的代码全部提交到 Git。
- 提交完成后，给当前提交打最新版本号对应的 tag，例如 `v0.0.5`。
- 发版本流程中不要执行编译、测试或构建，除非用户明确要求。

## 项目注意事项

- 当前产品分为 `Workflow`、`Table` 与 `Agent` 三部分：Workflow 负责多节点生成编排，Table 负责单一输入预处理，Agent 负责空间化 Codex 任务协作；不得把已删除的旧 Canvas / Art 恢复成第四部分。
- Table 与 Agent 在真实主体界面挂载前不得写成已完成；Agent 也不得继续只作为 Workflow 右侧聊天抽屉交付。
- UI 重构不能只创建未挂载组件；交付前必须确认真实 Workflow / Table / Agent 入口已经接入，并从用户当前可访问路径核对可见变化。
- 当前工作区项目和“我的素材”主要保存在浏览器本地，不要在文档中误写成已支持云同步。
- 当前 AI API Key 存在浏览器本地，并由前端直接请求 OpenAI 兼容接口；涉及安全说明时要写清楚。
- Docker 静态资源路径目前仍是待办项，文档中不要过度承诺生产部署已经完全验证。
