# 浏览器业务数据统一使用 localforage

Flovart 的浏览器业务数据统一通过 `localforage` 写入 IndexedDB，包括 Workflow 项目、Agent 布局、生成历史、素材索引、用量记录、模型选择和 Provider 模型缓存。图片与视频按 Blob 存入独立的媒体 store，项目与历史只保存引用，避免因一次小修改重复序列化大视频。

`localforage` 不是所有本地状态的唯一存储：主题、语言和面板宽度等首屏需要同步读取的小型 UI 配置可以保留在 `localStorage`；Agent 与 Hub 的短期连接 Token 使用 `sessionStorage`；Desktop Edition 的 Provider Secret 进入系统 Credential Manager；SaaS 账号、组织和共享数据继续由 Go 服务及 PostgreSQL 管理。纯 Web 模式需要持久保存 Provider Secret 时，将其密文写入 `localforage` Vault；会话模式不落长期密文。

浏览器存储受 origin 隔离，因此 GitHub Pages、Tauri WebView 与 Edge Extension 不能仅靠同名 `localforage` store 共享数据。安装 Desktop Edition 后，Rust Local Data Service 作为本地数据权威，通过经过配对和鉴权的类型化接口提供数据与执行能力；Edge Extension 不保存或读取原始 Provider Secret。

这项决定不改变后端语言分工：Rust 负责桌面壳、系统 Keyring、SQLite、本地 Runtime 和受限桥接，Go 继续负责 SaaS 的账号、组织、权限、审批、额度与共享资源，不把现有 Go 后端整体重写为 Rust。
