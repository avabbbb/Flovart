# Artifact 使用稳定 ID 与内容寻址

媒体使用稳定 Artifact ID 和校验和；临时 Provider URL、Blob URL、UI 节点及系统 Temp 不能成为工程长期素材。浏览器已有媒体仍按其 localforage 边界保存，原生效果使用持久文件及可重定位引用。

来源记录至少关联输入、实际生成参数、任务与模型，不强制每个单步效果创建 ProductionSpec/StageRun。素材版本固定，明确应用才改变效果引用；被工程引用的文件不得因任务结束或导入完成而删除。分享只复制用户明确选择的媒体与公开元数据。
