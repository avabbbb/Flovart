# 统一为一个 Agent 与一层 Skill 语言

Flovart 的正式产品与领域语言统一为四层：Flovart 是产品，Flovart Agent 是用户唯一直接协作的内置制作 Agent，Production Skill 是它加载的可复用制作方法，VOX Skill 是一个具体 Production Skill；后台 Specialist Agent 只作为实现中的临时专业分析者，不在主产品层级制造第二套人格。我们不再把“导演”同时用作主 Agent、Skill 类型和具体 VOX 包的实体名称，因为这种重名让用户误以为存在多个平级 Agent，也使代码、文档和界面无法形成统一心智模型。
