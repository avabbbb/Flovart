# 分离 Production 与 Skill Authoring 工作区

`/flovart new` 创建 Production Mode 的隔离 Production Session Workspace，只向 Coding Agent 提供 Runtime 生成的只读上下文、可写 scratch/exports 和非秘密 Session Binding；Agent 必须通过 Flovart CLI/MCP 修改 ProductionSpec、Canvas 或 Workflow，不得直接读写 Runtime SQLite、Keyring、Artifact Store 内部目录、Flovart 源码或任意用户磁盘。`/flovart skill dev <path>` 才创建 Skill Authoring Session，并在用户明确选择的 Production Skill 仓库内授予受宿主 Sandbox 与 Agent Tool Approval 约束的编辑权限。两种模式不得静默互换，Authoring Mode 调用真实付费生成仍需 Production Gate Approval。
