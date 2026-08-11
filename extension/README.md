# Flovart Browser Import（本地开发）

这个扩展是 Desktop-first 的薄伴侣：只把用户明确右键选择的图片，以分块 Native Messaging 传给 Flovart Desktop。它不保存 Provider Secret、不直连 Provider、不内嵌完整 WebUI，也不扫描整页。

## 本地安装

1. 构建 Desktop Native Host 与扩展：

   ```powershell
   cargo build --manifest-path src-tauri/Cargo.toml --bin flovart-host
   npm run ext:build
   ```

2. 打开 `edge://extensions`，启用开发人员模式，选择“加载解压缩的扩展”，目录选 `dist-extension`，然后复制扩展 ID。

3. 使用该 ID 注册 Native Host（只写当前用户注册表）：

   ```powershell
   powershell -ExecutionPolicy Bypass -File extension/register-native-host.ps1 -ExtensionId <EDGE_EXTENSION_ID> -Browser Edge
   ```

4. 启动 Flovart Desktop，重新加载扩展。在任意网页图片上右键选择“添加图片到 Flovart”；首次连接需要在 Desktop 明确批准。

从旧版扩展升级到 1.3 时，扩展会删除旧 `chrome.storage.local` 中的 Provider 凭证、Base64 待导入图、反推结果和整页采集数据；Desktop Keyring 与 Workflow 数据不受影响。

发布到 Edge Add-ons / Chrome Web Store 后，商店 ID 可能与本地旁加载 ID 不同。正式安装器必须把真实商店 ID 写进 Native Host 的 `allowed_origins`；不能用占位 ID 或通配符。
