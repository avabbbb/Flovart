# 保护本地 Runtime 通信

Desktop Runtime 在 `127.0.0.1` 随机端口提供版本化 Runtime Control API，并为每次启动生成和轮换 Bearer Runtime Token；PID、端口、协议版本和连接凭据只写入当前操作系统用户可访问的临时 Runtime Discovery Record。CLI 与 Ink TUI 必须先完成协议握手，修改命令携带 Idempotency Key；事件通过具有单调事件 ID 的 Runtime Event Stream 发送，并支持客户端使用 `Last-Event-ID` 断线续传。Tauri WebView 优先使用内部 IPC，不向普通浏览器暴露 Runtime Token。现有固定 `7421` 和读取原始 Provider Key 的 HTTP 接口由此决定取代：Control API 只能返回脱敏配置状态或打开设置界面的 deep link。Desktop Runtime 通过私有结构化 stdio IPC 调度 TypeScript Provider Worker，并只在单次执行所需范围内注入秘密；Worker 不得返回、持久化或记录原始凭据。
