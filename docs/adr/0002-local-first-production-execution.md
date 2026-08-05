# 制作执行保持本地优先

Flovart 的个人创作默认在用户控制的本地执行环境中完成，云端 Go 服务只承担账号、组织、社区、企业能力与 Production Skill 分发，不保存个人 Provider Secret，也不代替本地项目提交 Provider 任务。纯 Web 项目可以由 Browser Workspace 使用浏览器本地 BYOK 与前端 Provider Adapter 执行；Desktop 或已配对 Web 项目则由 Desktop Runtime 使用系统凭据库、SQLite 与本地 Artifact Store 承担可恢复执行。

同一项目任一时刻只能有一个本地执行与数据权威。项目从 Browser Workspace 转入 Local Data Service 时必须显式校验和转移，不能让浏览器与 Desktop Runtime 双写草稿、重复提交任务或静默合并状态。Desktop Runtime 继续使用 Tauri/Rust 承担可靠状态与本机能力，TypeScript Provider Worker 负责 Provider 协议；不新增本地 Go 守护进程，也不把个人制作隐式迁入云端。

纯 Web 路径受标签页生命周期、浏览器存储和同源脚本安全边界限制，产品与文档必须如实说明。未来如提供云端托管制作，应作为新的明确执行模式另行决策，不能改变现有本地项目的权威归属。
