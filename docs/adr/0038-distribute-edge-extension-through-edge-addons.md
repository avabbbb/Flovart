# 通过 Edge Add-ons 分发浏览器扩展

Flovart 的开源 Desktop Edition 继续通过独立 EXE 发行，Edge Extension 则作为独立 Manifest V3 发行物通过 Microsoft Edge Add-ons 分发；安装桌面版不自动安装扩展，未安装扩展也不影响 Desktop Edition 的本地画布、Workflow 或第三方 Provider 使用。Edge Extension 不是 Provider Plugin 或 Production Skill；商店版本必须按其最终产品范围单独披露权限与数据流，并链接适用于扩展的隐私政策和用户条款。

Edge Extension V1 是 Desktop Edition 的薄伴侣，不再打包完整 Flovart WebUI，不保存、解密或同步 Provider Secret，也不直接请求任何 AI Provider。它只实现三种 Browser Import Action：右键发送单张图片、发送选中文本、截取当前可见区域；不提供整页图片扫描、后台采集或浏览历史同步。所有生成、Provider 路由、费用与 Artifact 状态仍由 Desktop Runtime 负责。

Edge Extension 只通过 Chrome Native Messaging 连接随 Desktop Edition 安装的 `flovart-host`，再由 Host 转发到 Desktop Runtime；不保留扩展本地 Secret fallback 或第二套 Runtime。除 Official WebUI 外禁止网页 External Messaging；`https://avabbbb.github.io/Flovart/` 只有在用户明确配对后才能通过 Trusted Web Bridge 调用获批的类型化数据与 Runtime 能力，且永远不能读取原始 Provider Secret。商店 Manifest 只申请已实现功能必需的 `contextMenus`、`activeTab`、`scripting`、`nativeMessaging` 以及 Official WebUI 精确 origin 等权限，移除常驻 `<all_urls>` content script、全站 host permission 和不必要的 web-accessible resources。

用户发起“发送到 Flovart”而 Desktop Runtime 未运行时，`flovart-host` 自动启动或激活 Desktop Edition，等待兼容 Runtime 完成带认证的本地握手后再投递本次内容；不能静默把数据交给仅占用同一端口的任意进程。Desktop Edition 未安装时，扩展打开 Official WebUI；用户可以先创建独立 Browser Workspace，并从页面选择安装 EXE。Native Messaging 注册损坏时显示明确错误和连接修复指引，不得退回扩展内 Provider 调用。Edge 商店页面必须说明共享桌面工作区与自动唤醒能力依赖 Windows 10/11 x64 Desktop Edition。
