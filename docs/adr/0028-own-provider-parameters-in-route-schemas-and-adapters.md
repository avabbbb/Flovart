# 由 Route Schema 与 Provider Adapter 负责参数适配

Flovart 使用 Provider 无关的 Generation Request 作为产品层接口，每条 Provider Route 通过 Route Capability Schema 声明模式、参数、媒体角色、数量限制和序列化类型，再由 Provider Adapter 在提交前校验并转换为真实 Provider Request。我们不继续把 endpoint 正则和字段特例集中堆进通用网关，也不要求用户维护 JSON 请求模板，因为这两种做法都无法让 PromptBar、测试和运行时共享同一份可验证契约。
