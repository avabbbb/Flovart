# 以三种发行入口共享一个核心

Flovart 分别交付面向个人设计师的 Desktop Edition、面向 Coding Agent 用户的 Agent Toolkit 和面向托管服务的 SaaS Deployment，不要求一个安装包同时承担三类用户的依赖与运维复杂度；三种入口共享同一 Runtime、Canonical Command Registry、Provider-neutral Capability 和 Production Skill Package 契约。Desktop Edition V1 只正式支持 Windows 10/11 x64，入口必须是可直接安装的 EXE，且不得要求普通设计师预装 Git、Node.js、Go 或 Docker；macOS 与 Linux 桌面发行延后，Agent 与 SaaS 的安装和升级生命周期独立演进。

Windows Release 同时产出两个 NSIS EXE：官网主推小体积安装包，在系统缺少 WebView2 时自动下载补齐；支持页另提供内置 WebView2 Offline Installer 的完整离线包。两个产物安装同一 Desktop Edition，不形成不同功能版本，也不要求普通用户理解 WebView2。

开发与小范围内测可以使用未签名 EXE，但面向普通设计师的公开 Release 必须通过 Windows Authenticode 代码签名并带时间戳；Tauri Updater 的更新包签名继续独立存在，不能替代 Windows 对安装器发布者身份的验证。

Desktop Edition 的核心生成路径免注册登录并采用本地优先 BYOK：用户安装后只需配置自己的 Provider 凭据即可创作，本机 Runtime、项目与生成状态不得依赖 Go Hub、Enterprise Backend、PostgreSQL 或 SaaS 在线状态。账号登录只用于用户主动选择的 Skill Hub、云同步或组织服务，不能成为本地生成的前置条件。
