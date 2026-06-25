# Flovart

Flovart 是本地优先的 AI 画布与 Workflow 创作工具。本文固定 Provider、模型路由和生成默认值相关的领域词，避免后续把不同概念混在一起。

## 领域词

**Provider**：
用户保存的外部 AI 服务账号，用来提供文本、图片、视频或 Agent 等生成能力。
避免混用：Vendor、Channel、API Config。

**Model Preference**：
用户为某类生成能力保存的默认模型选择。
避免混用：Active Model、临时选择。

**Standard Model**：
Provider 托管的单模型生成端点，请求字段和结果格式由该 Provider 自己定义。
避免混用：OpenAI Compatible Model、Workflow App。

**AI App**：
Provider 托管的类工作流应用，运行前需要把用户输入映射到可编辑节点或字段。
避免混用：Standard Model、Plain Model。
