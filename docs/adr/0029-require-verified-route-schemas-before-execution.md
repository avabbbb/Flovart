# 只有已验证 Route Schema 的线路可以执行

Flovart 可以从 Provider 模型列表或用户输入发现新 endpoint，但把它们视为不可执行的 Discovered Route；只有进入版本化 Route Catalog、匹配精确 Route Capability Schema 且完成用户确认的 Route Binding 才能提交生成请求。我们拒绝按 endpoint 名称推断字段后直接执行，因为错误猜测媒体角色、参数类型或默认值可能造成请求失败、错误产物或意外计费。
