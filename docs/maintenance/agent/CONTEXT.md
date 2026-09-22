# Flovart current terms

本文只保留会直接影响当前实现的术语。产品行为以[主设计](../../design/flovart-native-effects.md)为准。

## Product surfaces

**Canvas**  
空间化 Workflow 创作面。旧文档中的“Canvas/Art 双系统”不恢复。

**Table**  
结构化媒体处理视图。可以维护局部处理状态，但不是第二份 Workflow authority；结果通过明确 commit 返回 Workflow/素材库。

**Agent surface**  
顶栏的本地/外部 Coding Agent 连接中心：discover / prepare / status / switch。  
_Avoid_: full-page chat、Tasks/Artifacts/Context 工作区。

**Assistant drawer**  
Canvas/Table 旁的 contextual drawer，包含 Assistant / Context / History。  
_Avoid_: Host picker、Agent 安装、Agent connection management。

## Agent and operations

**Agent Integration Skill**  
教 Codex、WorkBuddy 等如何使用 Flovart 稳定操作。  
_Avoid_: Production Skill Marketplace、权限授予、连接协议本身。

**Stable Agent operations**  
`status`、`workflow.inspect`、`workflow.selection.get`、`workflow.apply`、`workflow.node.run`。

**Flovart Link**  
本地 Host/Workflow 连接能力名称。  
_Avoid_: 第二份 Workflow、通用业务层或另一套 scheduler。

**Provider**  
真正提供图像/视频/模型能力的服务。  
_Avoid_: Coding Agent、CLI/MCP、creative host。

## Workflow and artifacts

**Workflow**  
用户与 Agent 共用的可见生产图。

**Workflow mutation**  
针对明确项目和期望版本的一次结构化修改。

**Artifact / result**  
生成或本地处理得到的可识别结果。需要持久化时必须有稳定 identity，不能只依赖临时 URL。

**Generation task**  
固定输入、目标、参数与幂等 identity 后的一次生成工作。不是聊天会话。

## Creative hosts

**Creative host**  
Photoshop / Premiere / After Effects / Resolve 等宿主。

**Native effect**  
由宿主保存并参与预览/导出的效果。面板、素材导入按钮或网页预览本身不等于 native effect。

## Historical terms

Production Crew、Director、Workspace Operator、Production Skill、Native Draft、Dock production control、enterprise credits/approval 都属于历史/实验概念，不应作为当前产品 IA 推导新功能。需要背景时看[历史快照](../../archive/historical-design/2026-09-23-canonicalization.md)。
