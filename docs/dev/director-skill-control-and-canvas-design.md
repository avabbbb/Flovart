# Director Skill 总控、Creator 与画布投影设计

## 当前结论

当前已经打通“Skill → CLI/MCP → Workspace Adapter → 可见 Workflow”的节点操作垂直链路；但 Provider Artifact 自动投影、ProductionSpec Revision 和局部 Stage 重编译仍未完成，不能把节点同步等同于完整 ProductionRun Projection：

| 表面 | 当前状态 | 是否同步可见画布 |
| --- | --- | --- |
| `generate.video` Production Runtime | 已真实生成、持久 Task/Event/Artifact | 否，只生成 Runtime Artifact |
| 正式 CLI/MCP 的 16 条 Workspace 命令 | 经 Managed Agent 调用页面内 `workflowDispatcher` | 是，要求 `workspace.status=ready` |
| CLI shadow runtime | Workflow 命令已停止使用该路径 | 否，不再作为节点回退 |
| Vite file queue | 可以入队，WebUI 没有消费端 | 否，可能返回误导性 pending |
| WebUI Local Agent Bridge | 面板连接时持有最新项目快照并执行类型化命令 | 是，现作为正式 Workspace Adapter |

因此，Coding Agent 现在可以通过 Skill/CLI 对用户当前画布执行创建、更新、移动、缩放、连接、选择和视口细修，并由 `workflow.inspect` 验证；但 CLI 生成的 Runtime Artifact 仍不会自动成为节点，任务进度也未绑定到镜头节点。下一阶段仍需用 ProductionSpec/Run Projection 统一生成状态与画布。

## 深模块与职责

### Director Compiler

小 Interface：

```text
compile(brief, inputs, context) -> ProductionSpecDraft
revise(parentRevision, feedback) -> ProductionSpecDraft
review(spec, artifacts) -> DirectorDecision
```

它隐藏风格知识、叙事方法、镜头拆解和质量规则，但不执行 Provider 请求、不接触 Secret、不维护任务状态。

### Production Control

面向 Flovart Skill、CLI、MCP 和 WebUI 的唯一制作 Interface：

```text
production.session.create
production.spec.create-revision
production.dry-run
production.approve
production.run
production.status / production.watch
production.retry-stage
production.replan
task.cancel
artifact.get / artifact.list
```

Runtime 在内部展开 ProductionRun、StageRun、ProviderAttempt、Artifact、预算和 Gate；调用者不需要学习 Provider payload、轮询协议或 SQLite 表。

### Workflow Projection

Workflow 是 ProductionSpec/ProductionRun 的可编辑投影，不是第二个制作计划：

```text
workflow.projection.get
workflow.layout.update
production.spec.create-revision
```

- `workflow.projection.get`：读取指定 Spec Revision/Run 的节点、阶段、Artifact 和状态投影。
- `workflow.layout.update`：只改位置、折叠、分组和视口，使用 `expectedLayoutRevision`，不创建 Spec Revision。
- `production.spec.create-revision`：所有有制作语义的画布修改都携带 `parentRevisionId`，创建不可变新 Revision，再重编译受影响阶段。

删除这个 Module 后，投影、Revision CAS、局部失效和事件同步复杂度会散落到 UI、CLI、Agent 与每个 Director Skill，因此它应成为深模块。

## 画布同步协议

Runtime 每次提交权威状态时追加脱敏事件：

```json
{
  "eventType": "workflow.projection.updated",
  "productionRunId": "run_...",
  "data": {
    "projectId": "project_...",
    "specRevisionId": "spec_...",
    "projectionVersion": 12,
    "changedNodeIds": ["shot_2", "take_2b"]
  }
}
```

WebUI 通过与 CLI 相同的 Production Runtime Event Stream 订阅事件；收到版本跳跃时重新读取 `workflow.projection.get`，不依赖 Agent 推送完整浏览器快照。

节点至少保存这些引用：

```text
productionSessionId
specRevisionId
productionRunId
stageRunId
shotId
selectedArtifactId
projectionVersion
```

进度显示来自 StageRun/ProviderAttempt Event，不由 UI 猜测。Provider 只返回阶段状态时显示“排队/提交/生成/下载/验证”，只有 Provider 提供可靠百分比时才显示百分比。

## 用户如何细修

| 用户操作 | 权威写入 | 后果 |
| --- | --- | --- |
| 拖动节点、缩放画布 | `workflow.layout.update` | 只更新布局 Revision |
| 修改镜头 Prompt、时长、运动、旁白、字幕 | 新 ProductionSpec Revision | 只失效该镜头及其下游 |
| 添加/替换参考图 | 新 ProductionSpec Revision + Artifact relation | 重新规划依赖该参考的 Stage |
| 在多个结果中选 Take | Spec/Projection 中更新 selected Artifact | 保留旧 Take，不覆盖文件 |
| 重新生成单镜头 | `production.retry-stage` 或 Revision 后新 Stage | 创建新 ProviderAttempt/Artifact |
| 调整 VO 或字幕时间 | 新 Revision | 只重跑 speech/render/verify |
| 仅裁剪、抠图、局部媒体处理 | 进入 Table Artifact 工具链 | 不把处理步骤伪装成 Workflow 生成语义 |

Agent 与用户同时编辑时，过期 `parentRevisionId` 返回 `PRECONDITION_FAILED`。Agent 必须重新读取最新 Projection，并把冲突交给用户或重新生成最小 Patch，不能最后写入者覆盖。

## Flovart 总控 Skill

总控 Skill 只编排以下稳定循环：

1. 发现 Runtime 与 Canonical Registry。
2. 加载 Primary Director Skill Snapshot。
3. 让 Director Compiler 产出 ProductionSpec Draft。
4. 运行 dry-run，显示能力缺口、路线报价、预算和 Gate。
5. 用户批准后启动 ProductionRun。
6. Runtime 自己运行；总控只 watch，不用 Agent 持续轮询。
7. 只有审片、语义失败、预算或额外输入触发 Agent Intervention。
8. 用户细修转换为 Spec Revision，或者只重试最小失败 Stage。
9. 以 Delivery Artifact、验证报告、费用与来源关系交付。

总控 Skill 不应该列出几十个 Provider 特化命令；其 Depth 来自用少量 Production Intent 隐藏任务恢复、成本、ProviderAttempt 和画布同步。

## Director Skill Creator

Creator 必须是独立 Authoring Skill，不并入运行时总控。推荐流程：

```text
create/import
  → scaffold
  → static validate
  → zero-cost dry-run
  → eval
  → pack
  → publish
```

标准包：

```text
director-skill/
├── SKILL.md
├── flovart.skill.yaml
├── agents/openai.yaml
├── schemas/extension.schema.json
├── references/style.md
├── evals/cases.yaml
└── assets/                 # 仅在确实需要可复用资源时
```

不要创建 README、安装指南或 Changelog。`SKILL.md` 保持精炼，把风格词典、镜头规则和长示例放入 `references/`。

### Manifest 最小形状

```yaml
schemaVersion: flovart.director-skill/1
id: community.vox-director
version: 1.0.0
productionSpec:
  coreVersion: "1"
  extensionSchema: schemas/extension.schema.json
runtime:
  minVersion: 0.4.0
capabilities:
  - image.generate
  - video.generate.image-to-video
  - speech.generate
  - media.render
  - media.verify
permissions:
  network: none
  secrets: none
  filesystem: package-readonly
gates:
  - id: approve-storyboard
    type: storyboard
  - id: approve-style
    type: style-bakeoff
evals:
  entry: evals/cases.yaml
license: MIT
```

禁止字段：

- API Key、Credential ID 或 Secret 环境变量；
- Provider endpoint、私有 Route ID 或硬编码模型请求；
- 任意 Shell/HTTP 执行；
- 自定义任务轮询和自动重提；
- 绕开平台预算、System Gate 或 Artifact Store 的私有 Stage。

### 导入 `vox-director`

保留：

- beat map、叙事弧与镜头节奏；
- style bake-off；
- 纸张拼贴风格、构图、字体与动画原则；
- VO、音乐、字幕与质量 Gate；
- image-first、image-to-video 的一致性方法。

迁移：

- Atlas Cloud 调用 → Provider-neutral Capability Requirement；
- 环境变量 Key → Desktop Keyring；
- 模型 ID → Validated Profile；
- ffmpeg 命令 → `media.render` Runtime Capability；
- 下载/轮询/重试 → Production Runtime；
- 风格专属字段 → `extensions.community.vox-director`。

## 分阶段放行

### S1：诚实能力面

- 已完成：Public MCP 只暴露 Canonical Registry 中 `available` 的命令。
- 已完成：Flovart Skill 区分 Runtime Artifact 与 visible Workspace 节点。
- 已完成：CLI/MCP 共用 Runtime/Workspace command surface，Workspace 写命令要求幂等键且不回退 shadow/file queue。

### S2：只读投影

- 实现 `artifact.get/list`、`workflow.projection.get`。
- `generate.video` 成功后在画布出现只读 Shot/Take/Artifact 节点。
- WebUI 关闭后重开仍从 Runtime 恢复同一投影。

### S3：可编辑 Revision

- 实现 `production.session.create`、`production.spec.create-revision`、`workflow.layout.update`。
- 支持 Prompt、参考、时长、旁白和 Take 选择的细修。
- CAS 冲突、局部 Stage 失效和旧 Artifact 保留通过测试。

### S4：完整导演制作

- 实现 dry-run、路线报价、预算、Gate、run、retry-stage、replan、render、verify。
- Director Skill Creator 完成 import/validate/eval/pack。
- 用迁移后的 VOX Skill 跑一条 image-first 30 秒样片，并验证全程画布同步与单镜头重做。

## 验收标准

只有同时满足以下条件，才能宣称“导演 Skill 运行时同步操作画布并支持细修”：

1. Coding Agent、CLI、MCP、WebUI 对同一 ProductionRun ID 读取到相同 Spec/Projection Revision。
2. 关闭 WebUI 后任务继续；重开后节点状态和 Artifact 自动恢复。
3. 用户修改单个镜头只创建新 Spec Revision，并只重跑该镜头及其下游。
4. 移动节点不触发生成；语义编辑不直接覆盖当前投影。
5. 每个画布结果能追溯到 StageRun、ProviderAttempt、Artifact、报价和验证报告。
6. Director Skill 全程无法读取 Secret 或直接调用 Provider。
