# 浏览器扩展使用桌面权威的受限导入桥

Edge Extension 定位为 Desktop Edition 的桌面优先薄伴侣，而不是第二套 Flovart WebUI、独立 Provider 客户端或项目数据库。Browser Import V1 的目标能力限定为用户显式触发的右键单图、选中文本和当前可见区域截图，但首个交付切片只实现右键单图；页面访问使用用户手势下的临时权限与按需注入，不常驻 `<all_urls>`，不扫描整页图片。扩展不保存 Provider Secret、不直接请求 AI Provider，也不复制完整 WebUI。Trusted Web Bridge 不纳入 V1，等桌面导入闭环通过真实验收后再单独决策和交付。

Desktop Edition 安装并注册 `flovart-host` Native Messaging Host，Host 只接受官方扩展 ID 和兼容协议。首次连接仍需用户在 Desktop 明确确认一组可撤销的 Extension Pairing Grant；`allowed_origins` 只证明调用扩展身份，不等于获得所有能力。Runtime 未运行时 Host 负责启动或激活 Desktop、进行有界等待并重试，但 Host 不保存 Provider Secret、导入队列或项目数据。只有 Local Data Service 返回类型化成功回执后，扩展才显示导入成功。

Browser Import Transfer 使用长连接 Native Messaging 的版本化控制信封和有界分块数据。扩展先声明稳定请求 ID、内容类型、总大小、内容哈希与来源元数据，Runtime 返回 `transferId`、`receivedBytes` 与下一序号后再接收分块；Host 只转发受限协议，Runtime 写入临时文件，并在大小、MIME 字节签名与哈希校验通过后发布 Artifact。连接中断后可用同一请求 ID 查询真实续传偏移，失败传输不能产生可见 Import 回执。选择这条路径是为了覆盖超过当前 1 MB Host 限制的真实图片和截图，同时避免公开 localhost 上传端口、单条 Base64 内存放大、Chrome storage 大载荷和桌面按网页 URL 回源的不确定性。

成功导入的图片与截图复制实际字节到内容寻址的本地 Artifact Store，选中文本保存规范化内容；网页 URL、标题、采集时间和媒体元数据只作为 Provenance。活动 Workflow 存在时，单图和截图映射为现有 `image` 节点，选中文本映射为现有 `text` 节点，并由 Workflow Draft Authority Port 在一个 Draft ChangeSet 中原子写入节点、`artifactId` 与来源 metadata。没有活动项目时，Local Data Service 将内容放入 Browser Import Inbox 并唤起 Desktop，扩展自身只保留非敏感状态与回执。

扩展的回程能力采用受限闭环，不提供项目全量同步或完整双向控制。白名单能力例如 `prompt.reverse` 由 Desktop Runtime 使用本机 Provider Route 与 Secret 执行，扩展只上传输入并在网页轻浮层展示进度和结果；预览不会修改项目，用户确认“加入 Flovart”后才原子提交 Artifact、结果和 Draft ChangeSet。取消或过期的预览输入由 Local Data Service 清理。

首个真实垂直切片是“网页右键单图 → Desktop 配对 → 分块传输 → Artifact Store → 活动 Workflow `image` 节点或 Browser Import Inbox → 成功回执”。在这条链路通过浏览器与 Desktop 实机验收前，不先扩展反推 Prompt、Official WebUI 桥或项目浏览能力。当前扩展内嵌完整 Vite 应用、扩展本地 Key、Content Script 直连 Provider、整页图片采集、泛化 External Messaging 和单槽 `chrome.storage.local` 交接都不再属于目标架构。

当前实现已落下这条切片的代码与自动验证：扩展只保留显式右键单图、临时精确来源权限和 Native Messaging；Desktop 以精确 Extension Origin 配对，Native Host 使用长连接分块协议并把字节提交到内容寻址 Artifact；WebView 通过现有 Workflow Dispatcher 投影标准 `image` 节点，无活动项目时保留在可见 Browser Import Inbox。正式发布安装器尚不能写入占位扩展 ID，必须在 Edge Add-ons / Chrome Web Store ID 确定后，把真实 ID 写入 Host `allowed_origins` 与 NSIS 安装/卸载 Hook；在此之前使用受控开发注册脚本进行实机验收。
