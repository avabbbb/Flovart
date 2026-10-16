# 以已批准样图锁定跨镜头视觉风格

对 VOX 等 image-first Production Skill，用户从同一代表镜头的多主题 Bake-off 中选定样图后，Flovart 将该不可变 Artifact 与结构化 Look 共同保存为 Approved Style Reference。当前 ProductionSpec Revision 的每个关键帧必须引用它，关键帧审片未通过时不得进入 image-to-video；只重复文字风格 Prompt 或只保存主题名称不能视为风格已锁定。当前 Revision 不允许原地更换参考；后续更换必须派生新 Workflow Draft/Revision，并只使受影响的关键帧及下游动态镜头失效。
