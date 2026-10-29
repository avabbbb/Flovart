# Flovart 画布产品评估、测试与优化反馈报告（2026-10-19）

## 1. 评估范围与方法

- 范围：本地仓库 H:/WorkSpace_For_VsCode/React/Floavrt，重点为 components/workflow 画布、持久化、文档与发布流程；参考 ComfyArt 的画布交互。
- 约束：仅本地工具；保持 Visible Workflow 权威（所有编辑经 applyWorkflowMutation / 草稿修订）；遵守 docs/design/01-interaction.md 与 docs/design/10-canvas-workflow.md；验证忽略 .tmp 与 node_modules。
- 方法：六个只读评估维度（交互体验、代码质量、性能、安全、发布就绪、入门/文档/i18n），每项给出 0–10 子指标与文件行号证据；主代理直接复核关键证据后只修复已确认的 P0/P1，并为每个修复补充测试。首轮评估代理因模型不可用全部失败，已改用可用代理重跑。

## 2. 基线指标（修复前）

| 维度 | 得分 | 关键证据 |
| --- | --- | --- |
| 交互体验 | 5 | 快捷键卡片宣称 Alt+Shift+F 自动整理，实际触发“聚焦选区”（WorkflowToolbar.tsx:186，InfiniteWorkflow.tsx:1977）；对话框内按 Delete/Backspace 会删除背后画布节点（InfiniteWorkflow.tsx:1947-1951）；方向键长按每步一条撤销 |
| 代码质量 | 5.5 | aiGateway.ts 4217 行、InfiniteWorkflow.tsx 约 2900 行等大文件；400ms 防抖持久化无 pagehide 落盘（store.ts:145-156）；渲染期写 projectRef（InfiniteWorkflow.tsx:377）；operations.ts 异步后用旧节点覆盖新节点 |
| 性能 | 6 | 视口裁剪与拖拽本地预览良好；WorkflowNode 未 memo，平移/缩放每帧全量重渲染；滚轮未按 rAF 合并；每次写盘序列化全部项目 |
| 安全 | 7 | 无 innerHTML/eval 风险；Agent 服务 CORS/令牌门控合理；.env.local 含真实格式 Gemini Key（未被 git 跟踪）；浏览器密钥库用公开信息派生口令（utils/keyVault.ts:33-50）；网页部署无 CSP |
| 发布就绪 | 6 | Vitest 误收 .tmp/worktrees 导致重复 React；CHANGELOG 为 0.1.0-beta.2 而 VERSION/package.json 为 0.1.0；Pages 部署不跑测试；无崩溃可观测性 |
| 入门/文档/i18n | 5 | quick-start 推荐 Gemini，而 SUPPORT_MATRIX 只认 RunningHub 为 Beta Provider；README 把 Codex 标为 Experimental 与 SUPPORT_MATRIX（Beta）不一致；workflow 组件约 758 行硬编码中文（44 个文件） |

基线综合：约 5.8 / 10。

## 3. P0 / P1 问题与修复

已修复：

1. P0 对话框内 Delete/Backspace 误删节点。新增 DELETE_BLOCKED_TARGET（可编辑元素 + menu/dialog/alertdialog/aria-modal），删除只在画布本身生效。
2. P0 Alt+Shift+F 快捷键名实不符。按 event.code === KeyF 识别（兼容 macOS Option 组合字符）并调用 autoLayout；裸 F 不再响应 Alt 组合。
3. P1 方向键长按污染撤销历史。按住期间只通过 patchProject 预览，松开方向键、按其它键、窗口失焦或卸载时经 pushHistory 合并为一条草稿修订；修订冲突时回退预览。调试中发现并修正：键盘 effect 重新绑定时不能在 cleanup 里提交。
4. P1 持久化丢失最后一次编辑。store.ts 在 pagehide 与 visibilitychange(hidden) 时调用 flushWorkflowPersistence。
5. P0 文档口径。quick-start.en.md 改为推荐 RunningHub（Beta pending certification），其它 Provider 标 Experimental；README 中 Codex 改为 Beta，并补充 RunningHub 说明。npm run docs:check 通过（163 个文件）。
6. P1 测试隔离。vite.config.ts 的 test.exclude 在 configDefaults 基础上排除 .tmp、.temp、.claude、dist-。

未修复（需负责人决策或超出本轮最小改动范围）：

- 待负责人：在 Google AI Studio 撤销 .env.local 中的旧 Gemini Key（已核实：BYOK 后代码不读取 GEMINI_API_KEY，该 Key 未进入 git 历史与 stash，删除该行不影响功能）。
- 已修复：版本号统一为 0.2.0（VERSION、package.json、package-lock、tools/flovart、tauri.conf.json、Cargo.toml/Cargo.lock），CHANGELOG 新增 0.2.0 条目，npm run version:check 通过，并已接入 Pages 部署门控。
- 已修复：Pages 部署（.github/workflows/deploy-pages.yml）改为 npm ci，并在构建前运行 docs:check、tsc --noEmit、npm test；待版本号统一后再加入 npm run version:check。
- 已修复：崩溃可观测性。新增 utils/crashLog.ts（全局 error/unhandledrejection 写入 50 条有界本地日志，自动脱敏 AIza/sk-/Bearer/apiKey，可导出诊断 JSON，不联网）与 components/AppErrorBoundary.tsx（中英双语兜底页，重新加载/复制诊断），在 index.tsx 接入；tests/crashLog.test.ts 3/3 通过。
- P1 i18n：从 WorkflowCreateMenu、WorkflowConfigPanel、WorkflowNodeToolbar、工具对话框开始接入语言键控文案。
- 已修复：滚轮平移/缩放按 rAF 合并（InfiniteWorkflow.tsx 原生 wheel 监听），同一帧多次 wheel 只写一次视口；切换缩放/平移模式时立即提交，重新绑定或卸载时只丢弃未提交的一帧、不在 cleanup 写项目。tests/workflowEditor.test.tsx 断言两次 wheel 合并为一帧且光标下世界坐标不变。
- P1 性能（下一轮）：WorkflowNode 使用 React.memo。调用处每个节点约 30 个内联回调，需先把回调提升为稳定引用；若用忽略函数的比较器会引入 tool/language 闭包过期的隐蔽 BUG，与“少复杂判断”的目标冲突，本轮不做。视口只在手势结束时持久化同列下一轮。
- P1 operations.ts 异步生成时用旧节点覆盖并发编辑。
- P1 删除提示增加“撤销”按钮；快捷键卡片由统一注册表生成并区分 macOS。

## 4. 测试与构建结果

- 基线（仅修正测试排除后）：194 个测试文件全部通过，1309 通过 / 1 跳过。
- 新增 tests/workflowCanvasKeyboard.test.tsx：长按方向键只记一条撤销且 Ctrl+Z 可还原；对话框内 Delete/Backspace 不删节点；画布 Delete 仍删除；Alt+Shift+F 触发自动整理。
- 画布相关 6 个测试文件：76/76 通过。
- npm run docs:check：通过。

- 最终全量验证（2026-10-19）：
  - npx tsc --noEmit -p .：TSC_EXIT=0。
  - npx vitest run：196/196 测试文件通过，1316 通过、1 跳过（共 1317，含新增崩溃日志测试）。
  - 稳定性备注：在与构建同时进行的重复全量运行中，tests/fakeProviderIntegration.test.ts 的 image-to-video 异步（create/poll/download）用例失败 1 次；单独重跑 3 次均 12/12 通过，判断为高负载下的偶发失败（flaky），列为遗留风险，建议后续放宽该用例超时或在 CI 中串行运行集成测试。
  - npm run build：BUILD_EXIT=0；遗留警告：index 主包 2,569.59 kB（gzip 821.99 kB）超过 500 kB，建议后续代码分割。
  - npm run docs:check：Docs contract OK，164 个文件。

## 5. 修复前后评分

| 维度 | 修复前 | 修复后 | 说明 |
| --- | --- | --- | --- |
| 交互体验 | 5 | 6.5 | 两个交互 P0 与撤销合并已修复；i18n 与快捷键卡片仍待完善 |
| 代码质量 | 5.5 | 6 | 持久化落盘补齐；大文件与并发覆盖风险仍在 |
| 性能 | 6 | 6.5 | 滚轮按帧合并已完成；WorkflowNode memo 需先稳定回调，留待下一轮 |
| 安全 | 7 | 7 | Key 轮换需负责人操作 |
| 发布就绪 | 6 | 7 | 测试隔离、Pages 测试/类型门控、本地崩溃日志与 ErrorBoundary 已完成；版本号统一待处理 |
| 入门/文档/i18n | 5 | 5.5 | Provider/Codex 口径统一；硬编码中文仍多 |
| 综合 | 5.8 | 6.4 | 六维平均（6.5+6+6.5+7+7+5.5）/6 |

## 6. 私测 / 早期推广建议

1. 私测前必须完成：撤销旧 Gemini Key；版本号已统一为 0.2.0，Pages 部署已加入 version:check 门控。
2. 私测对象先限定为中文用户与 RunningHub 路径，在 i18n 补齐前不面向英文用户推广。
3. README 增加“5 分钟私测上手”：下载安装 → 配置 RunningHub → 打开示例 → 运行一个节点，并附已知限制清单。
4. 已完成本地崩溃日志与诊断导出；私测反馈时请用户在出错页点击“复制诊断信息”。后续可在设置页增加入口。
5. 推广素材中的 Iris 字样（README 视频、videos/Iris_Promo）应与 Flovart 品牌统一后再对外。
6. 下一轮优先级：稳定节点回调后 WorkflowNode memo（大图流畅度）→ 核心流程 i18n → 删除撤销按钮与快捷键注册表。
