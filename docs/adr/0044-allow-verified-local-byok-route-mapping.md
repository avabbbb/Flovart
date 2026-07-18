# 允许用户验证本地 BYOK Route Mapping

Flovart 的创作页面保持 Product Model 与 Generation Mode 语义，不为每个 Provider 写固定交互；用户可以在设置向导中选择 Flovart 已支持的 Provider Adapter Family，把自己的 credentialRef、Base URL、Route ID 和声明式字段映射生成版本化的本地 Route Capability Schema，并在 Route Contract Test 通过和用户确认后将其作为 Local Verified Route 执行，真实 Provider Smoke Test 仍需单独批准费用。该决定扩展 ADR 0029：本地验证线路不必等待进入官方 Route Catalog，但未知协议不能通过任意 HTTP 模板或用户脚本获得秘密、网络和付费提交权，必须新增受审 Provider Adapter。
