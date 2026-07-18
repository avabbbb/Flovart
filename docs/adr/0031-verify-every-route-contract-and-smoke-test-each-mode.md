# 全量验证 Route Contract 并按 Generation Mode 做最小真实实测

每条进入 Route Catalog 的 Verified Route 都必须通过 Route Contract Test，覆盖 endpoint、请求字段、序列化类型、默认值、媒体角色与数量限制；只有局部工具函数或 UI 测试通过，不能据此声明 Provider 适配正确。端到端 Provider Smoke Test 按 Generation Mode 选择一条最低成本代表 Route，覆盖认证、媒体上传、提交、`/openapi/v2/query` 查询和结果解析；所有可能计费的真实提交仍需用户针对本次测试明确批准。未执行 Provider Smoke Test 时只能报告契约已验证，不能报告 RunningHub 线上已可用。
