# 用 Route Schema 约束控件并显式阻止不兼容请求

PromptBar 可选项由 Product Model 能力与当前 Route Capability Schema 的交集产生，Route 变更后必须重新校验已选参数与媒体输入。Route Preflight 发现分辨率、宽高比、时长、参考媒体角色、数量或开关值不受最终 Route 支持时，向用户展示冲突字段、当前值和允许值并阻止提交；Adapter 不得为了让请求成功而静默删除参数、替换为最近值或降级用户意图。只有 Route Schema 声明的显式默认值可以在用户未提供该字段时补入，并必须进入 Route Contract Test。
