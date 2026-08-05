# 不同发行入口共享一个核心

Flovart 分别交付面向设计师的 Web/Desktop Edition、面向 Coding Agent 用户的 Agent Toolkit，以及面向组织的 SaaS Deployment；不同入口可以拥有独立的安装、升级和运维生命周期，但必须共享领域模型、Canonical Command Registry、Provider-neutral Capability、Production Skill Package 与工作区数据契约，不能形成互不兼容的执行后端。

Desktop Edition 以普通设计师可直接安装和本地 BYOK 为边界，不要求 Git、Node.js、Go 或 Docker；Agent Toolkit 通过轻量 Bootstrapper 分发版本化 CLI、TUI、宿主适配与兼容 Runtime Bundle，不把完整源码仓库作为用户安装产物。Edge Extension 是 Desktop 的薄内容导入伴侣，不持有 Provider Secret、不直接生成，也不复制完整 WebUI 或 Runtime。

本地创作与生成不以账号登录为前置条件；登录只用于用户主动选择的社区、Skill Hub、云同步和组织服务。首次保存 Provider Secret 或发起可能计费的请求前必须取得版本化的本地协议同意。具体安装器格式、平台矩阵、签名、商店权限和启动命令属于发布与实施文档，不再分别创建 ADR。
