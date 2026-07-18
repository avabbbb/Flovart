# 将 RunningHub 标准模型作为原生 Provider 接入

> 状态：原生 Provider 的基础决定仍有效；下文最初 3 条线路的范围，以及把默认载荷保存在 Provider 配置里的做法，已由 [0027](0027-bind-product-models-to-provider-routes-by-mode.md)、[0028](0028-own-provider-parameters-in-route-schemas-and-adapters.md)、[0029](0029-require-verified-route-schemas-before-execution.md) 与 [RunningHub 首期 Route Catalog](../dev/runninghub-route-catalog.md) 取代。

RunningHub 标准模型使用 Provider 自己定义的字段名和任务结果格式，所以 Flovart 将它作为原生 Provider 处理，而不是伪装成 OpenAI Compatible。

这样做可以让 OpenAI 兼容接口继续保持简单路径，同时由 RunningHub Provider Adapter 处理模型路径、字段与任务生命周期。新的标准模型线路必须由版本化 Route Capability Schema 声明字段和默认值，不再把 endpoint 正则与临时默认载荷堆进通用 Provider 配置。

最初只验证了全能图片 G-2.0 图生图、全能图片 V2 图生图和 seedance2.0 多模态视频；该历史范围不再是当前实现清单。

最初字段列表不再维护，不能作为实现依据；当前 endpoint、字段、类型、媒体限制和默认值只认版本化 Route Capability Schema 与 Route Catalog。
