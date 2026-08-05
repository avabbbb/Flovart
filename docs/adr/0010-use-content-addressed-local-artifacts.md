# Artifact 使用稳定 ID 与内容寻址

导入、生成、预处理和交付媒体使用稳定 Artifact ID；Provider 临时 URL、浏览器 Blob URL 和界面节点都不能成为长期引用。Desktop 项目将媒体物化到按内容哈希寻址的本地 Artifact Store，Browser Workspace 则把 Blob 放入独立的 `localforage` 媒体 store，并在项目数据中只保存稳定引用，避免重复序列化大媒体。

Artifact Provenance 记录来源 Artifact、Workflow 或 Table 操作、ProductionSpec Revision、StageRun、模型与提示词摘要，使局部重跑、去重和设计师二次编辑仍能追溯来源。云端 Hub 默认不上传本地媒体；只有用户明确发布或共享时，才复制经过发布边界筛选的 Artifact。
