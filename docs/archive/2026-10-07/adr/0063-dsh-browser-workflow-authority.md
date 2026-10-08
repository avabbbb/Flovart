# 现有 DSH Browser 工具保持明确项目绑定

状态：现有实现约束，范围仅限当前 DSH Browser Workflow 接入；不作为新原生效果的生成架构。

现有 DSH profile 使用 browser 模式，通过受限代理读取/操作明确绑定的可见 Workflow。没有目标工作区时返回不可用，不创建隐藏 Draft、选择随机 Tab 或回退最近项目；同一修改仍走现有 revision 和幂等检查。

新效果采用[主设计](../design/flovart-native-effects.md)的独立任务与固定素材路径。旧 DSH Native Draft 和大型 Dock 目标已删除；这不表示本轮修改了 DSH 代码或已完成新的独立生成。
