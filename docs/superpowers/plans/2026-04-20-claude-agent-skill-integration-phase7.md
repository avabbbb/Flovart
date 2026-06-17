# Claude / Agent / Skill Native Integration Phase 7 Plan

> 目标：在 P1~P6 的基础上，把 Flovart 从“可被脚本操控的白板”进一步升级成 **Claude / Agent / Skill 原生可操作的创作系统**，让 Claude Code、Flovart skill、浏览器扩展、白板 Runtime API、Workflow、Storyboard 形成统一会话、统一命令、统一输出语义。
>
> 本阶段只做规划，不写代码。

---

## 0. 先说结论

你现在已经具备了打通 Claude/Agent/Skill 的所有基础部件，但它们还没有形成“原生集成层”。

### 已有基础

1. **Flovart skill 已存在**
   - 文档中已经明确把 Flovart 当作中枢技能来设计，见 [skills/flovart/SKILL.md:564-678](skills/flovart/SKILL.md#L564-L678)

2. **白板 Runtime API 已存在**
   - `window.__flovartAPI` 已暴露，见 [App.tsx:1898-1917](App.tsx#L1898-L1917)
   - 已有 `session / command / progress / canvas / generate / config`

3. **FlovartClient 已存在**
   - 支持通过 CDP 调用 `window.__flovartAPI`，见 [skills/flovart/scripts/flovart-client.js](skills/flovart/scripts/flovart-client.js)

4. **扩展 Bridge 已存在**
   - `FLOVART_COMMAND` 能从 extension background → content → web runtime api
   - 见 [extension/background/service-worker.js:112-151](extension/background/service-worker.js#L112-L151) 和 [extension/content/content.js:7-21](extension/content/content.js#L7-L21)

5. **协作脚本已存在**
   - 如 `import-from-libtv.js`、`import-from-runninghub.js`、`export-canvas-data.js`
   - 说明你已经在朝“技能系统 → 白板系统”的方向走了

### 当前缺的是什么
缺的是一层真正的平台语义：

> **Claude / Agent / Skill Native Integration Layer**

也就是：
- Claude Code 调白板，不只是“执行一个脚本”
- Skill 调白板，不只是“调用一个方法”
- Agent 在白板里操作，不只是“命令成功/失败”
- 而是：
  - 有统一 session
  - 有统一 action 语义
  - 有统一目标对象语义（canvas/workflow/storyboard/assets）
  - 有统一返回结构和可追踪 trace

---

## 1. P7 的目标边界

P7 完成后，产品应具备：

1. Claude / Skill / Agent 对 Flovart 的操作有统一 DSL 或动作协议
2. Claude 可以稳定地：
   - 查询画布
   - 创建/修改元素
   - 触发生成
   - 调用 workflow
   - 更新 storyboard shot
3. Flovart 能把结果稳定返回给 Claude / Skill
4. 每次 Claude 发起的动作，都有：
   - sessionId
   - commandId / traceId
   - target context
   - output refs
5. 插件、白板、Agent 三端共享 API Key / active model / active session 语义更清楚
6. 技能层从“脚本集合”升级为“白板操作协议 + 能力编排层”

### 本阶段不做
- 远程托管 agent runtime
- 完整 CLI-first agent bridge 改造
- 云端多用户协同命令总线
- 完整自然语言规划器直接嵌入白板前端

---

## 2. 当前系统状态诊断

## 2.1 Flovart skill 已经有“中枢技能”定位
从 [skills/flovart/SKILL.md:564-580](skills/flovart/SKILL.md#L564-L580) 可以看出，Flovart 已经被定义成：
- 和其他 skill 协作的中心
- 能接 LibTV / RunningHub / FFmpeg / Remotion / 发布工具

### 说明
这是很强的基础。

### 但问题
现在协作更像：
- skill 之间靠脚本 / JSON / 手工编排协作

而不是：
- 统一白板动作协议驱动协作

---

## 2.2 `window.__flovartAPI` 仍偏“底层 API”，不是 agent-native API
当前 [App.tsx:1831-1897](App.tsx#L1831-L1897) 暴露的方法有：
- `canvas.addElement`
- `canvas.getElements`
- `canvas.updateElement`
- `generate.image`
- `config.getProviders`
- `command.send/get/list`

### 问题
它更像：
- 低层画布 API

而不是：
- 面向 Agent/Skill 的高层动作 API

### 缺失的高层动作
例如现在还没有统一的：
- `storyboard.createShot`
- `workflow.run`
- `assets.saveOutput`
- `canvas.placeGeneratedResult`
- `selection.describe`
- `session.bindContext`

这会导致 skill 层越来越多地写脚本拼动作。

---

## 2.3 FlovartClient 现在是“技术连接器”，不是“语义客户端”
当前 [skills/flovart/scripts/flovart-client.js](skills/flovart/scripts/flovart-client.js) 主要负责：
- 连上 Chrome/CDP
- 调方法
- 返回结果

### 问题
它做的是：
- `execute(method, args...)`

而不是：
- `runWorkflow(template, context)`
- `createStoryboardShot(...)`
- `generateIntoCanvas(...)`
- `attachOutputToShot(...)`

### 结论
P7 应该把 client 从 transport client 升级成 semantic client。

---

## 2.4 Skill 层仍偏“脚本编排”而不是“动作编排”
现在 skill 生态里很多脚本，如：
- `generate-image.js`
- `batch-generate.js`
- `export-canvas-data.js`
- `import-from-runninghub.js`
- `import-from-libtv.js`

### 说明
这是很好的实验基础。

### 但问题
每个脚本都可能在自己定义：
- 输入格式
- 输出格式
- 错误处理
- session 语义

### 结论
P7 必须定义统一的 Skill ↔ Flovart Action Protocol。

---

## 3. P7 的总体架构

建议引入四层：

```text
Claude / Skill Layer
    ↓
Flovart Action SDK / Client Layer
    ↓
Flovart Runtime API Layer
    ↓
Product Domains (Canvas / Workflow / Storyboard / Assets)
```

### 1. Claude / Skill Layer
负责：
- 接收自然语言任务
- 规划动作
- 调 Flovart action

### 2. Flovart Action SDK / Client Layer
负责：
- 把高层动作转成 runtime command
- 统一 session/trace/target/output 格式

### 3. Runtime API Layer
负责：
- 稳定执行动作
- 记录 trace
- 返回结构化结果

### 4. Product Domains
负责：
- 真正修改画布
- 跑 workflow
- 改 storyboard
- 存资产

---

## 4. 推荐新增的动作协议层

建议新增：

```text
skills/flovart/runtime/
  flovart-actions.js
  flovart-types.js
```

或者：

```text
services/
  flovartActionRegistry.ts
```

### 统一动作接口建议

```ts
export interface FlovartActionRequest {
  sessionId: string;
  traceId: string;
  source: 'claude-code' | 'skill' | 'extension' | 'external-client';
  action: string;
  target?: {
    domain: 'canvas' | 'workflow' | 'storyboard' | 'assets';
    id?: string;
  };
  payload?: Record<string, unknown>;
}

export interface FlovartActionResponse {
  ok: boolean;
  sessionId: string;
  traceId: string;
  action: string;
  result?: unknown;
  outputRefs?: {
    elementIds?: string[];
    shotIds?: string[];
    assetIds?: string[];
  };
  error?: {
    code: string;
    message: string;
  };
}
```

### 为什么需要这层
因为以后：
- Claude Code
- 技能脚本
- 浏览器扩展
- 外部网页

都应该用同一种动作语言。

---

## 5. 推荐新增的高层动作集合

## 5.1 Canvas Actions

```text
canvas.describe
canvas.addElement
canvas.updateElement
canvas.removeElement
canvas.select
canvas.placeGeneratedResult
canvas.captureSelection
```

### `canvas.describe`
返回：
- 当前元素摘要
- 选中元素
- 活动板信息

非常适合 Claude/Agent 先理解上下文。

---

## 5.2 Generation Actions

```text
generate.image
generate.video
generate.keyframe
generate.fromShot
```

### 注意
现在 `generate.video` 还未真正打通到 runtime api 层，这正是 P7 里要顺带补齐的地方。

---

## 5.3 Workflow Actions

```text
workflow.describe
workflow.run
workflow.loadTemplate
workflow.createFromShot
workflow.attachOutput
```

### 这块特别重要
因为现在文档里已经写过 `workflow.run(templateName)`，但代码侧并没有真正形成稳定暴露面。

P7 应该把它补齐。

---

## 5.4 Storyboard Actions

```text
storyboard.createProject
storyboard.createShot
storyboard.updateShot
storyboard.attachOutput
storyboard.runShot
storyboard.listShots
```

### 作用
这会让 Claude/Skill 能真正“操作镜头”，而不只是操作画布元素。

---

## 5.5 Asset Actions

```text
assets.save
assets.list
assets.attachToCanvas
assets.attachToShot
```

---

## 6. FlovartClient 的升级方向

当前 [skills/flovart/scripts/flovart-client.js](skills/flovart/scripts/flovart-client.js) 的核心是：
- 连接
- `execute(method, args...)`

### P7 升级建议
新增一层 semantic methods：

```js
async describeCanvas()
async generateVideo(prompt, opts)
async runWorkflow(templateName, payload)
async createShot(payload)
async attachOutputToShot(shotId, output)
async saveAsset(payload)
```

### 这样做的好处
技能层就不用再大量拼低层 API 路径字符串。

---

## 7. Runtime API 在 P7 中的升级建议

当前 [App.tsx:1831-1897](App.tsx#L1831-L1897) 暴露的是偏底层 API。

P7 建议补出更完整的 runtime api 面：

```ts
storyboard: {
  createShot,
  updateShot,
  listShots,
  attachOutput,
}
workflow: {
  describe,
  run,
  loadTemplate,
}
assets: {
  save,
  list,
}
selection: {
  describe,
}
```

### 关键原则
P7 不应删除现有低层 API，而应在其上增加高层动作面。

这样：
- 低层 API 继续给自定义脚本用
- 高层 API 给 Claude/Skill/Agent 用

---

## 8. 与白板项目和插件的联动补充（你特别要求的部分）

## 8.1 共享 API Key 语义
P6 已规划观测层，P7 则补“可用层”：

### 要实现的语义
- Claude/Skill 发起动作时，默认使用白板当前 active key/model 偏好
- 如果动作来自插件，也能复用同一套 active key/model 语义
- 如果白板和插件 key 状态不一致，动作返回里要明确提示

### 建议新增 API

```ts
keys: {
  getActiveContext: () => {
    activeProvider,
    activeModel,
    sharedWithExtension,
    source,
  }
}
```

### 作用
Claude/Skill 执行动作前可先读当前上下文，而不是盲猜 provider/model。

---

## 8.2 插件与白板共享 session 语义
现在插件可以发命令，但命令和白板 session 没有真正绑定。

### P7 建议
每个插件发起的 `FLOVART_COMMAND` 都应支持：
- `sessionId`
- `traceId`
- `source = extension-*`

这样白板、扩展、Claude/Skill 都在同一个 session 语义里。

---

## 8.3 共享结果语义
插件和白板除了共享 key，还应该共享：
- 最近生成结果引用
- 最近选中元素
- 最近 reverse prompt 结果
- 最近 workflow 输出

### 不建议做法
不要都塞进 `chrome.storage.local` 当一次性状态。

### 建议做法
- 临时结果仍可桥接存储
- 正式结果以 `runtime session + outputRefs` 为准
- 插件只拿 ref，不长期持有所有 payload

---

## 9. 技能系统原生集成方向

## 9.1 从“脚本驱动”升级到“Action SDK 驱动”
你当前的 Flovart skill 文档已经很丰富，但执行层还是偏脚本。

P7 应该形成：

```text
Skill
  ↓
Flovart Action SDK
  ↓
Runtime API
  ↓
Canvas / Workflow / Storyboard / Assets
```

### 作用
以后任何 skill：
- `libtv-skill`
- `runninghub-api`
- `ffmpeg-compose`
- `capcut-mate`

都可以用同一层动作 SDK，而不是自己写桥接细节。

---

## 9.2 推荐新增的 Skill 级语义方法

```text
flovart.openOrAttach()
flovart.describeContext()
flovart.generateIntoCanvas()
flovart.runWorkflowTemplate()
flovart.createStoryboardShot()
flovart.attachResultToShot()
flovart.exportCanvasData()
```

### 为什么重要
这会让 Claude Code 里的 skill 真正成为“白板原生操作员”，而不是“外部脚本控制器”。

---

## 10. 推荐文件结构

### 新增

```text
skills/flovart/runtime/flovart-actions.js
skills/flovart/runtime/flovart-client-semantic.js
skills/flovart/runtime/flovart-action-types.js
services/flovartActionRegistry.ts
services/flovartContextResolver.ts
components/diagnostics/AgentActionPanel.tsx
```

### 修改

```text
App.tsx
skills/flovart/SKILL.md
skills/flovart/scripts/flovart-client.js
extension/background/service-worker.js
extension/content/content.js
hooks/useApiKeys.ts
services/runtimeTraceStore.ts   // P6 产物
services/workflowEngine.ts
```

---

## 11. 实施顺序建议

### Step 1：先补 Action Types
定义统一 action request/response 结构。

### Step 2：再补 Runtime API 高层动作
把 storyboard/workflow/assets 高层 API 补出来。

### Step 3：升级 FlovartClient 为 semantic client
让 skill 层不用到处写 `execute('canvas.addElement')` 这种低层调用。

### Step 4：插件命令链对齐 session/trace
把 extension bridge 拉进统一 session 语义。

### Step 5：Skill.md 升级
把 Flovart skill 从“脚本目录说明”升级成“动作协议说明 + 使用方法”。

---

## 12. 验证标准

P7 做完后，至少应满足：

1. Claude/Skill 可以用统一动作语言操作白板
2. 生成、workflow、storyboard、assets 都有高层动作 API
3. 插件发起的命令带 session/trace 语义
4. 共享 API Key 不只是“技术上能同步”，而是“动作层能知道自己在用哪套 key/model”
5. FlovartClient 不再只是 transport client，而是 semantic client
6. 技能系统可以稳定复用 Flovart 作为创作中枢

---

## 13. 风险点

### 风险 1：高层 API 和底层 API 双轨失控
解决：
- 高层 API 只面向 Agent/Skill/插件
- 底层 API 继续面向调试/脚本

### 风险 2：Skill 层继续直接绕过高层动作
解决：
- 在文档和实现上都强制推荐 semantic action layer

### 风险 3：共享 session 太早做复杂
解决：
- 先统一 sessionId/traceId/source 语义
- 不急着做超复杂多端会话恢复

---

## 14. 最后的建议

P7 做完之后，你这个项目才会真正从：

> “可以被 Claude 操作的白板”

变成：

> **“以白板为核心、以 skill/agent 为原生操作者的 AI 创作操作系统”**

这是非常大的质变。

因为到那一步，Claude/Skill/插件/Workflow/Storyboard/Assets 就不再是几个分散模块，而是一个统一系统里的不同入口。

---

## 15. 推荐的下一个规划主题

如果你还想继续补全完整路线，P8 最自然的是：

### P8：Collaboration + Publishing Pipeline
重点做：
- 多人共享 storyboard/workflow
- 结果审阅流
- 导出到 ffmpeg/remotion/capcut
- 最终发布链路

这样你的产品就会从创作工具真正走向创作平台。
