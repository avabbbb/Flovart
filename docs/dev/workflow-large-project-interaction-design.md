# Workflow 大型多节点项目交互与渲染设计

## 目标

在保留当前自研 Workflow 画布、项目数据和 Provider 逻辑的前提下，让包含大量图片、视频、分组和连线的项目仍能流畅浏览，并让图片与视频操作保持清晰、平衡、可扩展。

本设计同时解决两类问题：

- 性能：节点多、视频多时，缩放、平移、选择和拖动不能因大量 DOM、原图或播放器同时挂载而卡顿。
- 交互：上下文媒体条不能继续承载所有通用、图片、视频、布局、生成和危险操作。

本阶段不迁移 React Flow，不改变 Workflow Project、Provider、运行历史、PromptBar 或本地优先存储边界。

## 设计原则

1. 画布中的媒体首先是可导航的视觉代理，只有用户正在操作的媒体才升级为完整交互组件。
2. 是否渲染和渲染多重由屏幕投影尺寸、视口距离和交互状态决定，不只由节点数量决定。
3. 画布引擎负责坐标和手势，Render Planner 负责可见性和 LOD，媒体组件不自行猜测全局状态。
4. 上下文媒体条只提供当前选择最常用的动作，完整能力由二级菜单、工具面板和右键菜单承载。
5. Workflow Project、媒体资源契约和操作注册表保持引擎无关，为未来替换画布底座保留明确接缝。

## 深模块

### Workflow Render Planner

输入：

```ts
type RenderPlannerInput = {
  nodes: WorkflowNode[];
  viewport: WorkflowViewport;
  viewportSize: { width: number; height: number };
  selectedNodeIds: Set<string>;
  activeMediaId?: string;
  draggingNodeIds: Set<string>;
  expandedGroupIds: Set<string>;
};
```

输出：

```ts
type NodeRenderPlan = {
  nodeId: string;
  visible: boolean;
  mediaTier: 'placeholder' | 'micro' | 'thumbnail' | 'detail' | 'interactive';
  derivativeWidth?: 200 | 400 | 800;
  labelTier: 'hidden' | 'group' | 'short' | 'full';
  showPorts: boolean;
  showStatus: boolean;
  pinReason?: 'selected' | 'active-media' | 'dragging';
};
```

Planner 集中隐藏以下复杂度：

- 视口与 overscan 相交判断；
- 世界坐标到屏幕尺寸的投影；
- 缩放阈值抖动保护；
- 选择、播放和拖动节点的强制保留；
- 分组折叠、低缩放连线简化和标题显示；
- 图片缩略图、视频首帧和真播放器之间的切换。

组件只消费 Render Plan，不直接订阅完整节点数组后自行计算。

连线使用独立计划，避免把图级关系塞回单个节点：

```ts
type EdgeRenderPlan = {
  edgeId: string;
  tier: 'overview' | 'focus' | 'detail' | 'hidden';
  opacity: number;
  highlighted: boolean;
  bundledGroupPair?: string;
};
```

- Overview 保留细、低对比拓扑，可把相同分组对之间的边聚合为摘要；
- Focus 高亮当前组、当前节点和上下游路径，其余边降到约 0.1–0.2 opacity；
- Detail 显示完整连线与命中区；
- Hidden 只由用户显式隐藏连线或性能保护触发，不在全景中擅自删除叙事拓扑。

### Media Derivative Resolver

统一解析：

```ts
type MediaDerivatives = {
  sourceUrl: string;
  thumbnail200?: string;
  thumbnail400?: string;
  thumbnail800?: string;
  poster200?: string;
  poster400?: string;
  poster800?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  mimeType?: string;
};
```

- 原图和原视频只用于激活预览、编辑、下载和 Provider 输入。
- 普通画布节点使用接近屏幕尺寸的 WebP/AVIF 缩略图。
- 未激活视频始终使用首帧 Poster 图片，不挂载 `<video>`。
- Browser Workspace 导入媒体时一次生成本地衍生图并写入独立 `localforage` Blob store。
- Local Data Service、远端 Provider 或对象存储可返回同一资源契约，UI 不识别具体来源。

### Active Media Controller

维护当前唯一的交互媒体：

```ts
activate(nodeId)
deactivate(nodeId)
play(nodeId)
pause(nodeId)
```

规则：

- 全景和普通浏览状态下，Workflow 画布内挂载的 `<video>` 数量为 0。
- 单击视频先选中并显示上下文操作；选中不等于激活，只有显式预览或播放时才挂载一个 `<video preload="none" playsInline>`。
- 时长、尺寸和 Poster 从 Media Derivatives 读取；只有旧资源缺少元数据时才进行一次独立 metadata probe。
- 切换激活视频时暂停并卸载前一个播放器。
- 多选、框选、批量拖动和低缩放状态只显示 Poster。
- 故事板和放大预览使用独立媒体预算，不与 Workflow 画布播放器共享隐式状态。

### Interaction Overlay

PromptBar、上下文媒体条、尺寸标签、连接提示和节点状态使用画布外的共享 Overlay：

- 浮层保持固定屏幕像素尺寸，不随节点缩放成巨大或不可点击的控件。
- 浮层锚点由 `worldToScreen` 计算，不作为每个节点内部长期隐藏的 DOM。
- 选择变化只更新一个共享 Overlay，不让所有节点重新渲染工具条。
- 浮层先尝试节点上方，空间不足时翻转到下方，并避让顶部导航、底部工具栏和右侧 Agent 面板。
- 缩放低于可操作阈值时，点击节点先聚焦到可操作比例，再显示完整浮层。

### Canvas Engine Port

当前自研画布和未来画布引擎共同实现：

```ts
type CanvasEnginePort = {
  getViewport(): WorkflowViewport;
  setViewport(viewport: WorkflowViewport): void;
  fitBounds(bounds: WorkflowBounds, options?: FitOptions): void;
  worldToScreen(point: WorkflowPoint): WorkflowPoint;
  screenToWorld(point: WorkflowPoint): WorkflowPoint;
  getVisibleWorldBounds(overscanPx?: number): WorkflowBounds;
  hitTest(point: WorkflowPoint): CanvasHit | null;
  subscribeViewport(listener: (viewport: WorkflowViewport) => void): () => void;
};
```

Port 不拥有 Workflow Project、不执行 Provider、不写历史，也不决定媒体 LOD。当前实现先包住 `InfiniteWorkflow` 的坐标、视口和命中能力；未来 React Flow Adapter 只能替换这一层和对应手势绑定。

## 渲染分级

渲染阈值以节点投影到屏幕后的尺寸为主，避免不同画布尺寸使用同一个固定 zoom 阈值。

| Tier | 条件 | 媒体 | 节点 UI |
| --- | --- | --- | --- |
| Excluded | 不与视口 overscan 相交，且未被固定 | 不挂载 | 不挂载节点 DOM |
| Placeholder | 屏幕宽度小于 32px或投影面积过小 | 颜色块或极小代表图 | 仅状态点，隐藏标题和端口 |
| Micro | 屏幕宽度约 32–64px | 200px 图片或视频 Poster | 隐藏节点标题与端口，保留分组摘要 |
| Thumbnail | 屏幕宽度 64–240px | 200/400px 图片或视频 Poster | 短标题，隐藏配置与次要装饰 |
| Detail | 屏幕宽度大于 240px | 400/800px 衍生图 | 标题、状态、端口按需显示 |
| Interactive | 被激活且达到可操作比例 | 原图或唯一真视频 | 媒体控件和共享 Overlay |

默认 overscan 为视口短边的 50%，滚动或拖动速度高时可临时扩大。跨阈值使用滞回区间，避免缩放边界反复挂载。

低缩放时：

- 连线可简化或隐藏；
- 阴影、模糊、持续呼吸和复杂状态动画降级；
- 分组显示摘要、节点数量和代表图；
- 不挂载节点内部 Prompt、参数表单、媒体控件或隐藏工具条。

《莫羌》10% 全景中的典型节点约 62×35px，仍可通过人物、动物和雪山缩略图识别语义，因此不能把所有小于 48px 的媒体直接退化成无内容颜色块。

## 上下文媒体条

### 信息架构

上下文媒体条总共常驻 5–7 个高频动作，其中按媒体类型切换 3–5 个专属动作。

通用主动作：

- 编辑提示词；
- 预览或播放；
- 替换媒体；
- 下载；
- 更多。

图片专属动作候选：

- 裁剪；
- 高清；
- 去背景或蒙版；
- 扩图；
- 标注。

视频专属动作候选：

- 剪辑；
- 画面裁剪；
- 帧操作；
- 音频操作；
- 画面编辑。

最终常驻动作依据实际使用频率和能力可用性选择，不要求图片与视频按钮数量机械相等，而要求两者覆盖同样清晰的创作意图。

### 长尾分组

“更多”或工具面板按意图分组：

- 通用：复制、层级、保存素材、自由缩放、运行、删除；
- 图片构图：旋转、宫格切分、扩图；
- 图片质量：高清、打光、滤镜；
- 图片编辑：蒙版、去背景、图层、标注；
- 视频时间：剪辑、分割、拼接、变速；
- 视频帧：首帧、尾帧、当前帧、封面；
- 视频音频：音视频分离、人声分离、静音或替换；
- 视频画面：高清、去字幕、主体消除、修改、替换、抠像。

批量选择时改为批量操作条，只显示导出、分组、对齐、拼接等对当前选择集合合法的动作。

### 操作注册表

工具条、右键菜单和工具面板共享一份声明式能力注册表：

```ts
type MediaActionDescriptor = {
  id: string;
  mediaTypes: Array<'image' | 'video' | 'audio'>;
  selection: 'single' | 'multi' | 'both';
  intent: 'common' | 'compose' | 'quality' | 'frame' | 'audio' | 'edit';
  priority: number;
  surfaces: Array<'bar' | 'more' | 'context-menu' | 'toolbox'>;
  available(context: MediaActionContext): boolean;
  run(context: MediaActionContext): void | Promise<void>;
};
```

Provider 或本地能力缺失时隐藏或解释禁用原因，不在组件中堆叠大量条件分支。

## 大型项目交互

### 《莫羌》范本校准

对 LibTV 公开范本《莫羌》的只读实测得到以下规模。数字来自 DOM 采样；空间语义来自总览截图，属于高可信视觉推断，不作为 LibTV 内部实现声明：

| 状态 | 分组 | 图片 | 视频 | 连线 DOM | 媒体 DOM |
| --- | ---: | ---: | ---: | ---: | --- |
| 10% 全景 | 15 | 29 | 53 | 75 | 82 个懒加载 `<img>`，0 个 `<video>` |
| 100% 局部视口 | 3 个分组进入 overscan | 0 | 2 | 17 | 3 个 `<img>`，0 个 `<video>` |
| 100% 选中一个视频 | 同上 | 0 | 2 | 17 | 2 个 Poster，加 1 个 `preload="none"` 的 `<video>` |

全景中的图片使用约 400px WebP 衍生图，视频使用约 400px 首帧快照；它们在屏幕上的典型尺寸只有约 62×35px。切到 100% 后，React Flow 节点 DOM 从 97 个降到 5 个，说明细节浏览主要依赖视口裁剪；但 10% 全景本身包含整张图，裁剪无法减少节点，因此仍必须依赖媒体代理和 UI 降级。

《莫羌》的故事板把图片和视频放进两个独立滚动列。视频列包含 53 个结果，滚动高度约 14,000px，但任一滚动位置只挂载约 6–8 个 `<video preload="metadata">`。这证明它采用了有界挂载策略，但不据此推断具体虚拟列表库。Flovart 的故事板同样需要窗口化列表和独立媒体预算，不能只是把画布节点完整复制到侧栏。

视觉上，它并没有消除复杂拓扑：75 条跨组连线仍然密集。它保持可读和好看的主要原因是：

- 深色画布与低对比度分组底板形成稳定层级；
- 节点缩略图尺寸统一，标题、端口、工具和状态在全景中退场；
- 分组可以按内容形成竖列、横排或双列，而不是强行让整张图使用一种网格；
- 整体大致从素材、候选到结果向右展开，但只要求组内整齐，不对全图执行破坏创作语义的自动整理；
- 最小地图、适合屏幕和隐藏连线常驻在低视觉重量的底部控制区；
- 作品本身一致的黑白影像风格贡献了大量视觉秩序，画布引擎不能替代内容的艺术方向。

因此 Flovart 不能把“视口裁剪”当成唯一答案，也不能把“好看”误解为统一自动布局。正确组合是：全景依赖 LOD 和视觉层级，近景依赖裁剪和唯一活动媒体，组内提供局部整理，全局保留创作者的空间叙事。

### 导航层级

- 全景：看分组、镜头流向、状态和代表图，不操作媒体细节；即使所有节点都进入视口，也只渲染轻量代理。
- 中景：看节点标题、输入输出和主要连线，可选择、拖动和连接。
- 近景：操作媒体、Prompt、参数和工具。
- 故事板：按图片、视频、镜头或生成批次浏览结果，使用虚拟列表和独立播放器预算，不替代 Workflow 拓扑。

### 组织能力

- 自动整理只改变布局，不修改 Workflow 语义。
- 自动整理默认限制在选中分组或选中节点，不对整张大型项目强制重排。
- 分组提供标题、节点数、代表图、折叠状态和“聚焦此组”；允许竖列、横排和双列等局部构图。
- 全局空间契约保持创作阶段大致从左向右，组间间距显著大于组内间距；局部自动整理不能破坏用户建立的空间记忆。
- 低缩放下隐藏节点标题和端口，分组标题与摘要仍保持固定屏幕像素可读。
- 提供最小地图、适合屏幕、适合选择、隐藏连线和网格吸附。
- 连线在全景中默认降低对比度；用户隐藏连线后仍保留节点状态和分组之间的方向摘要。
- 工具箱承载可复用的复合预设与导演动作，不把预设拆成几十个 ElementBar 按钮。
- 右键菜单承载复制、创建副本、保存素材、删除和调试标识等低频通用命令。

### 局部聚焦与空间记忆

- 全景低缩放时命中优先级为分组、媒体代理、空白，避免在几十像素节点上误触端口或工具。
- 双击分组头或执行“聚焦此组”后使用 `fitBounds` 进入该组，才显示局部标题、端口和详细连线。
- Esc 或面包屑返回上一个 viewport，恢复用户进入分组前的中心点和缩放值。
- 低缩放点击单个媒体时，先把该节点聚焦到可操作比例，再挂载 PromptBar 与上下文媒体条。
- 这是 Flovart 的设计建议；现有只读证据只证明 LibTV 在 100% 下执行视口裁剪，不证明其具体使用了双击聚焦或 viewport 栈。

### 直接媒体交互

- 点击图片或视频本体必须直接选中节点并稳定挂载 PromptBar 与上下文媒体条。
- 视频选中与视频播放是两个状态；选择不应让所有视频开始解码。
- 拖动、缩放和框选期间暂停重型浮层更新，结束后一次重算锚点。
- 选中的离屏节点可保留状态，但媒体播放器必须在离屏后暂停或降级。

## 性能预算

首轮目标以常见中端桌面浏览器为基线，并拆成真实参考夹具与压力夹具。

参考夹具至少包含 15 个分组、100 个节点、50 个视频和 75 条连线：

- 10% 全景包含全部节点时，Workflow 画布内 `<video>` 为 0，媒体均使用懒加载且不高于 400px 的衍生图或 Poster。
- 固定 100% 单分组视口时，普通节点 DOM 不超过可见节点 + overscan，参考上限为 12。
- 激活一个视频时，Workflow 画布内 `<video preload="none" playsInline>` 不超过 1。
- 故事板在 1536×691 参考视口内只挂载可见卡片 + 2 行 overscan，`<video>` 不超过 8，且同时播放不超过 1 个。

压力夹具包含 300 个媒体节点和 100 个视频节点：

- 全景状态仍保持 Workflow 画布内 `<video>` 为 0。
- 平移和缩放 10 秒：P95 帧间隔不超过 24ms，不出现连续 3 帧超过 50ms。
- 普通节点 DOM 数量不超过视口与 overscan 内计划渲染的节点数量。
- 同一媒体在缩放期间不重复请求原始资源。
- 选择一个节点不触发所有未选中媒体节点重新渲染。

以上参考预算已用《莫羌》规模校准；实现大型回归夹具后，再以 Flovart 实机数据收紧阈值。

## 验收测试

### 渲染

- 创建 100 个视频节点，全景断言节点内没有 `<video>`。
- 创建 100 个同时进入全景视口的视频节点，断言仍只使用 Poster，证明优化不依赖离屏裁剪。
- 选中视频只显示 PromptBar 与上下文媒体条，不挂载播放器；显式激活后断言只有一个 `<video preload="none" playsInline>`。
- 切换激活视频，断言前一个播放器卸载且暂停。
- 平移使节点离开 overscan，断言普通节点 DOM 卸载。
- 缩放跨越 LOD 阈值，断言使用正确尺寸衍生图且没有抖动循环。
- 打开包含 100 个视频的故事板并滚动到首、中、尾，断言每次只挂载虚拟窗口内的卡片与不超过 10 个播放器。

### 交互

- 直接点击图片和视频本体，断言 PromptBar 与上下文媒体条稳定渲染。
- 图片与视频分别只显示当前类型合法的 5–7 个常驻动作。
- “更多”菜单按意图分组，危险操作与生成提交不会被误触。
- 多选时切换到批量工具条，单节点专属操作消失。
- 低缩放点击节点会聚焦到可操作比例，浮层不超出安全区域。
- 75 条边规模下，全景保留低对比拓扑；隐藏连线开关即时生效；选择节点后只高亮连接路径。
- 聚焦分组再按 Esc 返回，断言 viewport 恢复到进入前的位置和缩放值。

### 架构

- Render Planner、Media Derivative Resolver 和操作注册表可在没有 DOM 的测试中运行。
- Canvas Engine Port 有当前引擎契约测试，不引用 Provider 或持久化实现。
- Workflow Project 序列化不包含引擎私有节点对象。

## 实施切片

1. 加入渲染与媒体观测指标，建立大型夹具和性能基线。
2. 引入 Media Derivative Resolver，补齐图片缩略图和视频 Poster 契约。
3. 引入 Workflow Render Planner，实施视口裁剪、overscan 和 LOD。
4. 引入 Active Media Controller，改为仅激活视频挂载。
5. 把 `WorkflowNodeToolbar` 重构为声明式上下文媒体条与“更多”菜单。
6. 抽出 Canvas Engine Port，并用契约测试封住当前自研实现。
7. 使用真实大型项目和《莫羌》范本复核视觉层级、浮层避让和性能预算。

每个切片独立可验收，不需要等待未来画布引擎迁移。

当前已完成 Poster 与活动视频切片：本地视频拥有独立持久化 Poster，项目导入会重建 Poster；主画布和批次视图默认只渲染 Poster 或轻量占位，“选中”不再自动挂载播放器，显式激活后也只允许一个 `<video preload="none">`。下一阶段是 Workflow Render Planner 的视口裁剪、overscan 与完整 LOD；项目导入媒体的“暂存 → 原子提交/丢弃”仍是需要单独收口的持久化边界。
