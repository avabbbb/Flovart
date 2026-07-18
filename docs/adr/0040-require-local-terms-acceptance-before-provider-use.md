# 在首次 Provider 使用前取得本地协议同意

Desktop Edition 允许用户在不注册账号、不接受协议的情况下先浏览界面并编辑不产生外部请求的本地内容；在首次保存 Provider Secret 或首次发起可能计费的 Provider 请求前，必须展示用户协议、隐私政策和第三方 API 风险摘要，并由用户明确勾选同意。Local Terms Acceptance 只在本机记录协议版本与同意时间，不上传账号系统；协议发生影响数据流、费用或责任边界的实质变更时，在下一次 Provider 请求前重新确认。Edge Extension 不另行取得 Provider 协议同意，因为它不持有 Secret 或执行生成，但首次使用网页导入能力时仍需展示扩展权限与本地传输说明。
