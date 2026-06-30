# LibTV 全功能模块化分析 — 总览

> 分析对象: LibLib.tv 平台完整使用指南(~1336 行) + libtv-skills MIT 协议
> 分析目的: 逐模块对照 Flovart Workflow 现状，输出 gap 分析 + 实现方案 + 优先级
> 落盘策略: 每模块一份文档，确保上下文压缩后可恢复
> 分析日期: 2026-06-29

---

## 模块索引

| # | 模块 | 文档 | 核心内容 | 优先级 |
|---|------|------|---------|--------|
| 01 | 无限画布 + 5 节点 + 工作流 | `01-canvas-nodes-workflow.md` | 节点类型/连线/打组/工作流保存/整组执行 | P0 |
| 02 | Script 脚本节点(新版分镜故事板) | `02-script-node.md` | 剧本拆解/资产提取/分镜编辑/批量生图生视频 | P0 |
| 03 | Slash 快捷功能(12+) | `03-slash-commands.md` | 多机位九宫格/剧情推演/25宫格/光影矫正/三视图/故事板等 | P1 |
| 04 | 图像工具 | `04-image-tools.md` | 全景720/多角度/打光/九宫格/基础编辑/宫格切分/标注/旋转镜像/分镜组 | P1 |
| 05 | 视频工具 | `05-video-tools.md` | 高清/解析/剪辑/合成/人声分离/音视频分离 | P1 |
| 06 | 导演台(3D构图) | `06-director-stage.md` | 人体素模/几何模型/群众阵列/相机机位/角色姿势/全景图 | P2 |
| 07 | 音频工具 | `07-audio-tools.md` | 截取/变速 | P2 |
| 08 | 图像生成器 | `08-image-generator.md` | 风格库/焦点编辑/镜头聚焦/摄像机控制 | P1 |
| 09 | 视频生成器 | `09-video-generator.md` | 主体库/运镜控制(20+预设) | P1 |
| 10 | 模型清单 | `10-model-catalog.md` | 图像/视频/语言/音频模型全量清单 + BYOK 适配 | P2 |

---

## 关键决策(已拍板)

---

## Flovart Workflow 现状盘点

### 已有节点类型(5 种)
`WorkflowNodeType = 'image' | 'text' | 'video' | 'audio' | 'config'`

### 已有图像工具(7 种)
crop / filter / upscale / removeBackground / outpaint / mask / splitLayers

### 已有工作流能力
- 节点连线(有向无环图，validateWorkflowConnection 防环)
- 节点打组(batchId + batchIndex，折叠/展开)
- 工作流保存(store.ts persist 到 localforage)
- 整组执行(run_generation op)
- 创建菜单(5 节点类型)
- 节点工具栏(对齐/导出/复制/删除/属性/裁剪/滤镜等)
- Agent 面板(WorkflowAgentPanel，已有 agentSessions)

### 缺失(LibTV 有而 Flovart 无)
- Script 节点类型
- 剧本拆解 / 资产提取 / 分镜编辑
- Slash 快捷命令(12+ 专业能力)
- 全景 720° / 多角度 3D 坐标球 / 打光面板
- 视频高清/解析/剪辑/合成/人声分离
- 导演台 3D 构图
- 图像风格库 / 焦点编辑 / 镜头聚焦 / 摄像机控制
- 视频主体库 / 运镜控制
- 音频截取/变速

---

## 实施阶段建议

| 阶段 | 模块 | 目标 |
|------|------|------|
| Phase 2.1 | 01 + 02 | Script 节点 + 工作流编排基础 |
| Phase 2.2 | 03 + 08 + 09 | Slash 命令 + 生成器增强(风格库/主体库/运镜) |
| Phase 2.3 | 04 + 05 | 图像工具 + 视频工具补齐 |
| Phase 2.4 | 06 + 07 | 导演台 + 音频工具 |
| Phase 2.5 | 10 | 模型清单全量适配 |

---

总览完。各模块详细分析见对应文档。
