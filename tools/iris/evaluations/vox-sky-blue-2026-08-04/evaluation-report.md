# Flovart × VOX 科普短片 + 本地 Coding Agent 画布同步真实评测

## 测试信息

- 日期：2026-08-04/05
- 项目：`H:\WorkSpace_For_VsCode\React\Floavrt`
- 运行环境：release `flovart.exe`（0.3.0），Desktop Runtime `desktop-runtime`，RunningHub 单 Key
- 测试目标：① 跑通一条真实 Vox 风格科普短片；② 验证「本地 Coding Agent → dry-run → 前端画布同步 → HITL 二次修改」全链路；③ 评估是否可上线内测
- 选题：**为什么天空是蓝色的**（瑞利散射，`how_it_works` 叙事弧，4 节拍 / 8 镜头，30s）
- 主题：`swiss-modern`（用户确认）；质量门禁 **100/100，零 violation**
- 产物：`production-spec.v1.json`、`evaluation-report.md`、`ai-native-canvas-blueprint.md`

## 执行结果

| 阶段 | 结果 |
| --- | --- |
| `production.dry-run` | `production_run_019fcbb6-6cda-7af0-925e-e150bc6364fb`，编译 20 个 StageRun DAG |
| 系统门禁 | route-plan + run-budget 经 `production.approve` 批准（硬上限 ¥5.00） |
| 关键帧 8×`image.generate` | 全部成功（`flovart:gpt-image-2`，¥0.10/张） |
| 动态镜头 8×`video.generate` | 全部成功（`flovart:grok-imagine-video-1.5` 图生视频，¥0.24/段，`sourceImageIds` 引用关键帧 taskId） |
| 旁白 TTS / 合成 / 验证 | 成功（本地，免费）；`narrationIncluded=true`、`captionsBurned=true` |
| 音乐 `audio.music` | blocked（无 capability，计入 `completed_with_warnings`） |
| 成片状态 | **`completed_with_warnings`**（19 成功 / 1 blocked），run 执行 27m50s |
| 确认费用 | **¥2.72**（8×0.80 + 8×1.92），与 route plan 预估完全一致；实际账单以 RunningHub 控制台为准 |

## 成片验收（ffprobe + 受控 verify）

| 项目 | 结果 |
| --- | --- |
| 时长 | 30.000s |
| 画面 | 1280×720，24fps，H.264 |
| 音频 | AAC，22050Hz |
| 校验 | `delivery:verify` passed=true（audio aac / duration 30s / resolution 1280×720 / video h264 全通过） |
| SHA-256 | `60904628e44319c1af4ed59839ce349c5c8c3271dd708717b5a82ec107a7f408` |

## 关键测试 1：前端画布同步（PASS）

`production.dry-run` 完成后：

- 权威投影 `workflow.projection.get` 产出 **21 节点 + 18 连线**；
- `workflow.inspect` 确认 **21 个投影节点真实落在可见画布**，与权威投影完全一致；
- 运行中投影适配器每 ~1.5s 轮询，节点状态实时同步 `loading → success/error`；
- 阶段完成后节点**自动升级类型**：关键帧→image、动态镜头→video、旁白→audio，metadata 携带受控 `artifactRef`（taskId + sha256 + byteSize，**不含私有存储路径**）；
- 用户手建节点在多次投影刷新中**保留**。

## 关键测试 2：HITL 二次修改（PASS，但有重要边界）

对投影节点做 `workflow.node.update`（改标题/内容）、`workflow.node.move`（改坐标）、`workflow.node.resize`（改尺寸）：

| 操作 | 安静期验证 | 运行期验证 |
| --- | --- | --- |
| move | ✅ (420,120)→(520,400)，4 个刷新周期不回弹 | ✅ loading 期间 (650,500) 保留 |
| resize | ✅ 320×220→420×260 保留 | ✅ 保留 |
| update 标题/内容 | ✅ 保留 | ✅ 保留 |
| **节点 text→image 升级时** | — | ✅ 升级瞬间 (650,500) 保留 |

**边界发现（BC-HITL-002）**：当**后续 stages 继续完成、投影重新物化新媒体节点**时，被手动移动的节点可能被**重新布局拉回默认网格附近**。安静期（无状态变化）持久，活跃物化期可能被覆盖。

## BAD CASES（按严重度）

### BC-RUN-001（P0）· StageRun 失败导致 production.run 死锁，阻塞全部后续 run

**触发**：任意 motion 阶段失败后（旧 run `production_run_019fc576` 的 `shot:context-detail:motion` failed），`delivery:render` 依赖失败被 skip，`delivery:verify` 依赖 render。

**根因**：release 构建中 `delivery:verify` 的 `dependency_failed` 判断只认 `["failed","canceled","blocked"]`，**不认 `skipped`** → verify 永远 pending → run 永不终态 → 调度线程无限续租（实测该僵尸 run 从 08-03 卡到 08-04）。

**后果**：僵尸 run 永久占用唯一调度线程，**所有后续 `production.run` 排队永不执行**（本次新 run 排队 30+ 秒即此因）。

**修复**：工作区未提交改动已加 `"skipped"`（worker.rs 依赖失败判断）。本次通过 `task.cancel` 协作式取消僵尸任务释放调度线程（验证取消路径可用）。**内测前必须提交并重构建**。

### BC-MEDIA-001（P1→已修）· 投影媒体节点画布上不显示

**用户实测**：画布上只有文字节点显示成功，image/video 节点（调 API 的）不显示媒体内容。**三层根因已逐层定位并修复**：

1. **ACL 权限缺失**：`runtime_artifact_read` 加入 invoke_handler（lib.rs:148）但未加入 `src-tauri/permissions/runtime.toml` 的 `runtime-control` → Tauri v2 拒绝前端 `invoke('runtime_artifact_read')` → 图片/视频全部加载失败。**已修复**（commands.allow 加 `runtime_artifact_read`）。
2. **CSP 缺 `media-src`**：`img-src` 有 `blob:` 所以图片能显示，但视频/音频 blob 落到 `default-src 'self'` 被拦截。**已修复**（CSP 加 `media-src 'self' blob: data:`）。
3. **视频激活守卫 bug**：`InfiniteWorkflow.tsx:437` 的 `activeMedia` 守卫只放行 `storageKey||href`，投影视频（仅 `artifactRef`）激活即被清 → `<video>` 永不挂载。**已修复**（守卫 + `onActivateMedia` 都放行 `artifactRef.taskId`），**用户已确认视频可播放**。

**佐证**：投影视频节点显示 duration+size（metadata）但无内容；重新上传（变 storageKey）即正常——正是守卫条件导致。图片先显示、视频后修复的差异正是 CSP `media-src` 缺失。

### BC-CRED-001（P1→已实现方案）· Runtime 凭证对网页端不可见/不可用

**用户原话**：「读取了凭证却不能同步到 API 配置里，那这个有啥用」。Runtime 有 RunningHub 凭证（系统 Keyring），`provider.status` 可读，但网页端「模型映射」只消费浏览器 `userApiKeys`，不消费 Runtime 的 `productModels/routes` → 网页端生成无法用 Runtime 凭证。

**已实现**：设置页「桌面 Runtime 凭证」每张凭证卡片新增**「一键导入到 API 配置」**：
- 创建 `runtimeManaged` 网页 Key（**无明文**，带 credentialId + Runtime 全部路线）；
- 模型映射可推荐这些路线（新增单测 `tests/runtimeModelMappingSync.test.tsx` 验证 G-2/Grok/Veo 建议）；
- `aiGateway` 的 `generateImageWithProvider/generateVideoWithProvider` 检测到 `runtimeManaged` 后经 `runtime_execute` 路由到 Runtime 执行（新增 `services/runtimeGeneration.ts`），明文只存在于系统 Keyring。

### BC-HITL-001（P1）· 重新 dry-run（新 session）清空上次 HITL 画布修改

重新用新 idempotency key 跑 dry-run → 新 production session → 投影节点全部替换为新 ID，**上次 move/resize/title 修改全部丢失**；用户手建节点保留。需要 `production.spec.create-revision`（同 session）或跨 session 布局保留。

### BC-GATE-001（P2）· `review-keyframes` 人工审片门禁未在运行期强制

spec 声明 `keyframe-review: required`，但关键帧完成后 **motion 立即提交图生视频**，未等待人工审片。VOX skill 要求「Block paid motion until keyframe checks pass」。当前 gate 只记录、不执行。

### BC-RUN-002（P2）· 媒体读取 IPC 只在 Tauri 桌面可用

`loadRuntimeArtifactBlob` 在非 Tauri 环境直接抛错。浏览器 tab / Web 版无法在画布显示 Runtime 产物媒体。若内测含 Web 端，需给受限 Web 方案。

## 本轮代码变更

- `src-tauri/permissions/runtime.toml`：`runtime-control` 加 `runtime_artifact_read`
- `src-tauri/tauri.conf.json`：CSP 加 `media-src 'self' blob: data:`
- `components/workflow/InfiniteWorkflow.tsx`：`onActivateMedia` + activeMedia 守卫放行 `artifactRef.taskId`
- `types/index.ts`：`UserApiKey.runtimeManaged` 字段
- `components/SettingsPanel.tsx`：Runtime 凭证「一键导入到 API 配置」
- `services/runtimeGeneration.ts`（新）：Runtime 媒体生成路由 helper
- `services/aiGateway.ts`：runtimeManaged key 走 Runtime 生成
- `tests/runtimeModelMappingSync.test.tsx`：新增导入后路线推荐测试
- 工作区另有未提交修复：`worker.rs` `skipped` 依赖失败（BC-RUN-001）

## 上线可行性评估

**结论：核心链路已真实跑通并可修复后内测，但当前 release 构建需先完成三件事。**

**已经真实跑通：**

1. Coding Agent 编译 VOX spec → 质量门禁 → dry-run → **投影真实落到可见画布** ✅
2. **画布状态/类型实时同步**（loading/success/error，text→image/video/audio 升级，含受控 artifactRef）✅
3. HITL 二次修改安静期**持久不回弹**，节点升级瞬间手动布局保留 ✅
4. 真实成片链路（关键帧→图生视频→TTS→合成→验证）端到端，**¥2.72 可控** ✅
5. 协作式 `task.cancel` 可释放卡死调度 ✅
6. **媒体上画布**（图片缩略图 + 视频可播放）经 ACL/CSP/守卫三层修复后 ✅（用户确认图片可见、视频可播）
7. **Runtime 凭证一键导入**网页 API 配置 + 模型映射推荐 + 生成走 Runtime 路由（已实现，待实机验证生成）

**上线前必须完成：**

1. **P0 BC-RUN-001**：提交 `skipped` 死锁修复并重构建；加 run 终态收敛保护。内测一遇失败镜头就 scheduler 卡死，不可接受。
2. **P1 BC-HITL-001/002**：HITL 布局跨 session / 活跃物化期保留策略。
3. **实机验证**：一键导入的 `runtimeManaged` key 在 PromptBar 真实生成一次，确认 Runtime 路由端到端。

**建议的内测路径：**

1. 提交工作区（`skipped` 死锁修复 + ACL 权限 + CSP + 守卫 + 凭证导入 + runtimeGeneration）。
2. 重新构建 release exe，重启 Desktop 复测。
3. 内测开放「单条成片 + 画布投影 + 媒体显示 + HITL 安静期微调」为主路径；**AI-Native 画布直搭**作为下一步范式（见下）。

## AI-Native：从「后端生成→投影」到「画布上直接搭」

用户核心诉求：**AI 应在画布上像设计师一样创作**——每个节点怎么连、提示词怎么写、用哪些二次处理工具，都直接在画布上操作并留下记录，设计师才能二次编辑。当前 `production.run` 在 Runtime 后端出片、画布只看到成品，无法满足。

**已有基础**：`workflow.node.create/create-connected/connect/update/move/resize` 等 16 条可见画布命令 + 内置 Agent 15 条类型化工具，全部可用。**缺的是创作范式**：把「编译 spec→后端跑」改成「Agent 在画布上创建节点、写入 `metadata.prompt`（PromptBar 可见可编辑）、真实连线、逐步生成」。

**蓝图已备**：[ai-native-canvas-blueprint.md](./ai-native-canvas-blueprint.md) 定义 8 关键帧 + 8 动态镜头 + 旁白的节点结构、每个节点的完整提示词、连线方式和构建命令序列。

| 维度 | production.run（后端生成） | AI-Native（画布直搭） |
| --- | --- | --- |
| 提示词落点 | Runtime spec，画布只有成品 | 每个节点 `metadata.prompt`，PromptBar 可见可编辑 |
| 连线 | 投影适配器铺 | Agent 用 workflow.connect 真实连线 |
| 设计师二次编辑 | 只能看到成品 | 每个节点、连线、提示词都可改 |
| 过程可追溯 | 无 | 画布即过程 |

## 后续建议（按优先级）

1. **P0**：提交 `worker.rs` skipped 修复 + 重构建 release；加 run 终态收敛保护。
2. **P1**：Spec Revision（同 session）或投影节点按 stageKey 稳定 ID，避免重规划清空 HITL 布局。
3. **AI-Native 范式**：用现有 workflow.* 命令实现「Agent 画布直搭工作流」，让 designer 用户拿到可编辑流程。
4. **P2**：`review-keyframes` 门禁在调度器强制。
5. **实机验证**：一键导入的 runtimeManaged key 在 PromptBar 真实生成一次（验证 Runtime 路由端到端）。
