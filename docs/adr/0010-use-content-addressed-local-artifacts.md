# 本地 Artifact Store 是媒体真相源

所有导入、生成和交付媒体都必须物化为按内容哈希寻址的本地 Artifact，Provider 临时 URL、浏览器 Blob URL 和创作界面节点都不能作为长期真相源。Workflow、Table、Canvas 和生成历史只保存 Artifact ID；Artifact Provenance 记录制作版本、阶段、模型、提示词哈希与输入关系。Hub 默认不上传用户媒体，只有用户明确发布时才复制指定 Artifact，从而保证恢复、去重、局部重跑、隐私和可审计交付。
