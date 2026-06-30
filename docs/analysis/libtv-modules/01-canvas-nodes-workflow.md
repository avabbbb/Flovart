# 模块 01 — 无限画布 + 5 节点 + 工作流

> 对照 LibTV 无限画布、5 类基础节点、工作流编排能力，分析 Flovart Workflow gap
> 日期: 2026-06-29

---

## 1. LibTV 功能详述

### 1.1 无限画布
- 画布无限延伸，节点自由拖拽、缩放、放置
- 双击空白处 → 添加节点 → 选择类型
- 支持跨画布复制(节点从一个项目复制到另一个)
- 快捷键: 缩放/移动/创建等

### 1.2 5 类基础节点

| 节点 | 承载 | 输入方式 |
|------|------|---------|
| 文本 | 文本信息 | 手动输入 / LLM 生成 |
| 图片 | 单张图片 | 上传 / 图像模型生成 |
| 视频 | 单个视频 | 上传 / 视频模型生成 |
| 音频 | 单个音频 | 上传 / 音频模型生成 |
| 脚本 | 生成脚本 + 批量分镜 | 上传剧本 / 角色 / 参考视频 |

> Script 节点详见 `02-script-node.md`，本模块只覆盖前 4 类 + config。

### 1.3 工作流编排
- **节点连线**: 拖拽连线搭建任务工作流，方便复杂任务一键自动执行
- **打组**: Ctrl+G 对选中节点打组
- **创建工作流**: 保存当前节点+连线结构到左侧栏，可复用
- **整组执行**: 选中一组节点，一键按连线顺序自动执行

### 1.4 连线语义(推断)
- `文本 → 图片`: 文本作 prompt 生成图
- `图片(角色) → 图片(分镜)`: 角色图作参考生成分镜
- `图片(分镜) → 视频`: 分镜图作首帧生成视频
- `音频 → 视频`: 音频作参考生成带音视频
- `脚本 → 视频`: 脚本直接驱动批量视频

---

## 2. Flovart 现状

### 2.1 已有能力 ✅

| 能力 | 实现位置 | 状态 |
|------|---------|------|
| 5 节点类型 | `types.ts:3` `WorkflowNodeType` | ✅ image/text/video/audio/config |
| 节点创建 | `constants.ts:18` `createWorkflowNode` | ✅ |
| 节点连线 | `ops.ts:41` `validateWorkflowConnection` | ✅ 有向无环图防环 |
| 节点打组 | `InfiniteWorkflow.tsx:1053` batchGroups | ✅ batchId 折叠/展开 |
| 工作流保存 | `store.ts:139` persist 到 localforage | ✅ |
| 整组执行 | `ops.ts:158` `run_generation` op | ✅ 单节点级，缺整组编排 |
| 创建菜单 | `WorkflowCreateMenu.tsx` | ✅ 5 类型 |
| 节点工具栏 | `WorkflowNodeToolbar.tsx` | ✅ 对齐/导出/复制/删除等 |
| Agent 面板 | `WorkflowAgentPanel.tsx` | ✅ agentSessions |
| 视口缩放 | `types.ts:13` `WorkflowViewport` | ✅ x/y/k |

### 2.2 Gap 分析 ❌

| LibTV 能力 | Flovart 现状 | 差距 |
|-----------|-------------|------|
| 跨画布复制 | 无 | 需实现跨项目节点复制(Ctrl+C/Ctrl+V 跨 project) |
| Ctrl+G 打组 | batchId 折叠但无快捷键 | 需绑 Ctrl+G 快捷键 + 打组 UI |
| 保存工作流到左侧栏 | store 只存 project，无"工作流模板"概念 | 需新增"工作流模板"持久化(节点+连线快照) |
| 整组执行(按连线拓扑序) | `run_generation` 只触发单节点 | 需实现拓扑排序 + 按序自动执行 |
| 连线语义(参考图注入) | 连线只做视觉连接，不传数据 | 需实现: 上游节点 href/输出 → 下游节点参考输入 |
| 双击空白创建 | 需确认 | 需检查 InfiniteWorkflow 是否已支持双击空白 |
| 节点缩放 | freeResize 字段已有 | 需确认 UI 是否支持拖拽缩放手柄 |

---

## 3. 实现方案

### 3.1 跨画布复制(P1)
```
// clipboard 存节点+连线快照
// 粘贴时重生成 ID，偏移位置
// ops.ts 新增 paste_nodes op
```
- 数据结构: `WorkflowClipboard { nodes: WorkflowNode[], connections: WorkflowConnection[] }`
- 新增 op: `paste_nodes` (重生成 ID + 偏移)
- 跨 project 粘贴: 从 clipboard 创建到当前 project

### 3.2 Ctrl+G 打组(P0)
- `InfiniteWorkflow.tsx` 绑定 Ctrl+G: 选中节点 → 分配同一 batchId
- 新增 op: `group_nodes { ids: string[], batchId: string }`
- 打组 UI: 虚线框包围 + 组标题(可选)

### 3.3 工作流模板(P1)
```ts
// types.ts 新增
export interface WorkflowTemplate {
  id: string;
  title: string;
  nodes: WorkflowNode[];        // 模板节点(无 ID 冲突)
  connections: WorkflowConnection[];
  createdAt: string;
}
```
- store 新增 `templates: WorkflowTemplate[]`
- UI: 左侧栏新增"工作流模板"区，拖入画布 → 实例化(重生 ID)

### 3.4 整组执行 — 拓扑排序(P0)
```ts
// ops.ts 新增
export function topoSort(nodes: WorkflowNode[], connections: WorkflowConnection[]): string[] {
  // Kahn 算法: 按 fromNodeId→toNodeId 拓扑排序
  // 返回节点 ID 数组，按执行顺序
}
export function executeGroup(projectId: string, nodeIds: string[]): void {
  const order = topoSort(...);
  // 依次触发 run_generation，上一个 success 后触发下一个
}
```
- `InfiniteWorkflow.tsx` 新增"整组执行"按钮(选中 ≥2 节点时显示)
- 执行队列: 上游 success → 触发下游，上游 error → 中断并提示

### 3.5 连线数据传递(P0)
```ts
// WorkflowNodeMetadata 新增
referenceNodeIds?: string[];  // 显式声明参考来源(可从连线推断)
// generation 调用时:
// 上游 image/video 节点的 href/storageKey → 下游参考输入
```
- `workflowGeneration.ts:161` 已有 `relatedIds` 概念，需强化:
  - 从 connections 推断上游节点
  - 上游 image href → 下游 prompt 的参考图
  - 上游 video href → 下游视频生成的参考视频
  - 上游 audio href → 下游音频参考

### 3.6 双击空白创建(P1)
- 确认 `InfiniteWorkflow.tsx` 是否已有双击空白 → `WorkflowCreateMenu`
- 若无: 绑定 onDoubleClick 到画布空白区

---

## 4. 优先级

| 子项 | 优先级 | 理由 |
|------|--------|------|
| Ctrl+G 打组 | P0 | 基础交互，低成本 |
| 整组执行(拓扑排序) | P0 | 工作流核心价值 |
| 连线数据传递 | P0 | 连线无数据传递 = 空壳 |
| 跨画布复制 | P1 | 体验优化 |
| 工作流模板 | P1 | 复用能力 |
| 双击空白创建 | P1 | 交互对齐 |

---

模块 01 分析完。
