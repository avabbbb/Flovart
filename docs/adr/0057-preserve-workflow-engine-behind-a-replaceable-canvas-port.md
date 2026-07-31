# 在可替换画布端口后保留当前 Workflow 引擎

当前阶段保留 Flovart 自研 Workflow 画布，不因 LibTV 使用 React Flow 而重写节点、连线、选择、历史、Provider 或项目数据；先引入独立的 Workflow Render Planner、Media Derivative Resolver、Active Media Controller、Interaction Overlay 和 Canvas Engine Port，由当前画布实现首个 Adapter，并以视口裁剪、屏幕尺寸驱动的媒体 LOD、仅激活视频挂载和轻量浮层达到大型项目性能目标。Workflow Project 与 Production 数据继续是引擎无关的权威状态，媒体操作注册表也不依赖画布组件；未来只有在完成这些优化后仍无法达到性能预算，或协作、子图、自动布局等能力的维护成本持续超过适配成本时，才新增 React Flow 或其他引擎 Adapter，通过同一端口替换视口、坐标、命中测试、选择和手势实现，不迁移业务数据或 Provider 契约。
