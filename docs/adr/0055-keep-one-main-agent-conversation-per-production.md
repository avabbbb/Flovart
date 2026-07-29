# 每个 ProductionSession 保留一条主对话

每个 ProductionSession 只有一条可恢复的 Flovart Agent 主对话负责推进正式制作上下文，用户可以从任意节点创建探索分支，但分支在被明确提升为主分支前不能创建新的 ProductionSpec Revision 或请求 Production Mandate。内置 PI Agent 使用独立的 Agent Session Store 保存主对话、分支、消息、工具轨迹和 Specialist Report；Node 进程独占该 SQLite 文件，浏览器只保存 Agent Workspace 布局，也不让 Node 直接打开 Desktop Runtime SQLite。会话记录只以稳定 ID 引用 Runtime 中的权威 Spec、Run、Mandate 与 Artifact，因此 PI 版本、推理模型或会话库变化后仍能从权威快照重建；我们不采用每条流式消息都经 Runtime API 写入生产库，不采用每次打开作品都重新开始，也不允许多个平级对话并发改写同一制作计划。
