# Flovart Browser Import（本地开发）

这个扩展是 Flovart 的薄伴侣，有两条通道：

- Desktop 通道：把用户右键选择的图片或视频（PNG / JPEG / WebP / GIF / AVIF、MP4 / WebM）以分块 Native Messaging 传给 Flovart Desktop。
- 网页画布通道：网页画布经 externally_connectable 与扩展建立 Port（名称 flovart-web，协议版本 1）。配对只能在扩展 popup 里批准；批准后支持右键发送媒体到当前 Workflow、BYOK Key 同步和插件内反推。

扩展只处理用户明确选择的媒体，不扫描整页，不内嵌完整 WebUI。导入有分块进度反馈，popup 保留最近 5 条导入历史与失败引导。

## 网页画布通道

允许连接的网页 origin 由 background/web-origins.js 生成并写入 manifest：正式站 flovart.avabbbb.com，以及本地 127.0.0.1:37522 与 localhost:37522。网页侧用环境变量 VITE_FLOVART_EXTENSION_IDS 配置扩展 ID（32 位 a-p，逗号分隔，可同时写商店 ID 与旁加载 ID）。

1. 配对：在画布「设置 → 安全」的浏览器插件区申请配对，再在扩展 popup 的「网页画布」区点击允许。未批准前不收发任何业务消息；拒绝或断开会删除配对条目，网页可以重新申请。
2. 发送媒体：右键「发送图片到网页画布」或「发送视频到网页画布」。单个媒体上限 64 MiB，分块传输并校验大小与 SHA-256，落到画布当前 Workflow；画布没有打开的项目时只保存媒体。
3. Key 同步：配对批准后，画布 Vault 中的 Key 同步到扩展（首次全量，之后增量，revision 不一致时回退全量）。扩展用不可导出的 AES-GCM 密钥加密后写入 chrome.storage.local，按网页 origin 分区；撤销或拒绝配对即清空该 origin 的 Key。画布开启「退出时清除」时不会同步 Key。
4. 插件内反推：右键「反推图片提示词」。按 Google、OpenAI、Anthropic、OpenRouter 的顺序选用已同步的 Key，都没有时退到带 Base URL 与默认模型的 OpenAI 兼容 Key。请求从扩展直接发往模型服务商（不申请额外 host 权限，依赖服务商 CORS），图片上限 20 MB。结果只保存在 chrome.storage.session（浏览器关闭即清空），可在 popup 复制，或「发送到网页画布」成为当前 Workflow 的文本节点。反推指令、请求体与响应解析和网页端共用 background/reverse-prompt-core.js。

## Desktop 通道本地安装

1. 构建 Desktop Native Host 与扩展：

        cargo build --manifest-path src-tauri/Cargo.toml --bin flovart-host
        npm run ext:build

2. 打开 edge://extensions，启用开发人员模式，选择“加载解压缩的扩展”，目录选 dist-extension，然后复制扩展 ID。

3. 使用该 ID 注册 Native Host（只写当前用户注册表）：

        powershell -ExecutionPolicy Bypass -File extension/register-native-host.ps1 -ExtensionId <EDGE_EXTENSION_ID> -Browser Edge

4. 启动 Flovart Desktop，重新加载扩展。在任意网页图片上右键选择“添加图片到 Flovart”；首次连接需要在 Desktop 明确批准。视频导入需要 Desktop 侧的 browser.import.video 能力。

## 升级与发布

从旧版扩展升级到 1.3 时，扩展会删除旧 chrome.storage.local 中的 Provider 凭证、Base64 待导入图、反推结果和整页采集数据；Desktop Keyring 与 Workflow 数据不受影响。

发布到 Edge Add-ons / Chrome Web Store 后，商店 ID 可能与本地旁加载 ID 不同。正式安装器必须把真实商店 ID 写进 Native Host 的 allowed_origins，网页端也要把它加入 VITE_FLOVART_EXTENSION_IDS；不能用占位 ID 或通配符。
