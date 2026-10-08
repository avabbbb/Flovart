# 使用 Schema 驱动的统一 Route Mapping

产品层只表达 Route Mapping Target：媒体能力由 Product Model 与 Generation Mode 共同标识，文本能力由 Runtime Capability 标识。用户在一个“模型映射”中心为目标绑定有序 Provider Route；PromptBar、Workflow、Table 与 Agent 不再各自保存 Model Preference，也不把 Provider 包装别名伪装成新的 Product Model。

每条可执行 Provider Route 必须具有版本化 Route Capability Schema，由 Provider Adapter 据此校验媒体角色、数量、参数和序列化类型，再生成真实 Provider Request。RunningHub 标准模型使用原生 Adapter，OpenAI Compatible 保持独立通用路径；未知 endpoint 只能作为 Discovered Route 展示，不能根据名称猜字段后直接执行。本地 BYOK Route 也必须属于已支持的 Adapter Family，并在契约校验和用户确认后才可执行。

PromptBar 控件与提交前 Route Preflight 使用同一 Schema，不得静默删除、替换或降级用户已选参数。价格预估必须基于最终 Provider Request，失败时显示未知；是否阻止提交由 Run Budget 决定。ProviderAttempt 开始后锁定 Route，不因失败或 `submission_unknown` 自动换线，避免重复任务与双重计费。

具体线路、默认优先级、Provider 字段和实测证据属于 Route Catalog 与 Provider 施工文档，不再各自创建 ADR。
