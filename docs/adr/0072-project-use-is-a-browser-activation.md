# workflow.project.use 是一条浏览器激活命令而非本地指针更新

状态：已记录的延迟修复决定；当前实现行为未变，回归详情见[待测试确认](../content/docs/progress/pending-test.mdx)「workflow.project.use 浏览器激活缺失」。

`workflow.project.use` 的正确语义是一次跨进程激活握手：Agent 请求 → Browser `setActiveProject(X)` → store 变化经 `pushSnapshot` 回推 → `WorkflowAgentSession.updateSnapshot` 更新 boundSnapshot → 新的 writer/lease 目标确立 → 才向调用方 resolve。当前实现把它当普通 mutation 直发浏览器（`workflowDispatcher.ts:242-246`），只改浏览器 store 的 `activeProjectId`，agent 侧绑定依赖异步快照回推、无任何确认握手，因此 `project.use` 返回 `ok` 时 `/health` 的 `activeProjectId` 可能仍是旧项目，后续显式 `--project-id X` 写入会被 `agent/session.js:355` 以 `LEASE_TARGET_CHANGED` 拒绝。

本轮不修：该缺陷不在 5/5 Golden Task 关键路径（trial 走 `project.create` 自动激活），而修复要求 session↔browser 之间新增「切换确认」握手的真实行为改动。记录此 ADR 是为了冻结预期语义——`project.use` 的完成条件是 agent 侧 boundSnapshot 已指向目标项目，而不是浏览器已收到命令。
