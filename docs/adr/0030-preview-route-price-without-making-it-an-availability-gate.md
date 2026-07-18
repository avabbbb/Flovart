# 展示 Route Price Quote 并仅由预算超限阻止提交

RunningHub Route 在正式提交前使用其 `price-preview` 能力生成 Route Price Quote，并且价格请求与正式提交必须复用同一个 Provider Adapter 产出的 Provider Request，避免预估字段和实交字段分叉。拿到价格后向用户展示并参与 Run Budget 判断，只有超过用户批准的预算边界才阻止提交；价格服务失败时把价格明确标记为未知并给出警告，但不把价格预估本身变成生成可用性的硬依赖，也不以零价、历史价或静默默认值替代未知结果。
