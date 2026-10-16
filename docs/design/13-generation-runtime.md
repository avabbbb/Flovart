# 模块：Generation & Local Runtime

> 状态：**Current truth**。总纲见[总体设计](00-overview.md)。

## 1. 职责

一条生成路径：任务、Provider 路由与适配、费用确认、持久素材、本地控制服务。所有入口（宿主面板、Canvas、Table、CLI、MCP、Assistant）调用同一个任务函数。

## 2. 当前实现

| 部分 | 位置 | 状态 |
| --- | --- | --- |
| Web 生成入口与生命周期 | `services/aiGateway.ts`（`executeUnifiedIgnition` 内按 route 分派 submit / poll / cancel / reconcile） | 已实现 |
| 正式 Provider 能力与序列化 | `services/providerGenerationAdapter.ts`；共享类型 `services/providerAdapter.ts` | 已实现 |
| 用户线路（受限 JSON mapping） | `UserScriptProviderAdapter`、`registerUserScriptProvider()` | 已实现，Experimental |
| 本地 Runtime | `src-tauri/src/runtime/`（tasks、store、registry、runninghub、control_server、worker） | 已实现，部分 Experimental |
| 固定 fixture 生成 | `runtime.test.fixture-image` → `task.get` → `artifact.locate` | 已实现，本地测试通过 |
| 输入整理 | `components/workflow/inputResolver.ts` | 已实现 |

当前 Browser 直连与 Rust Runtime 是两条既有边界，不宣称已统一。

## 3. Provider 路由

- 能力由 **Route Capability Schema** 描述（媒体角色、数量、参数、序列化类型）；PromptBar 控件与提交前 Preflight 使用同一 schema，不静默删除或降级用户已选参数。
- 用户在“模型映射”中心为目标绑定有序 Provider Route；各 surface 不各自保存模型偏好。
- 价格预估基于最终 Provider Request；未知就显示未知。Attempt 开始后锁定 Route。
- 用户线路只能访问脱敏 `input`，endpoint 必须 HTTPS 公网，路径限定在同一 endpoint 下，凭据仅在最终请求时注入，不执行任意 JS。
- 当前认证中：RunningHub 图像 + 视频路由（Beta，待认证）；OpenAI-compatible、Seedance 等为 Experimental。具体线路见 [archive 中的 Route Catalog](../archive/2026-10-07/dev/runninghub-route-catalog.md)。

## 4. 任务

最少字段：ID、幂等键与请求摘要、固定输入快照、目标引用、状态、Provider 任务 ID、结果引用、可解释错误。

~~~text
queued → running → completed | failed | canceled
running → unknown_submit（查询原任务，不重提）
~~~

- 请求摘要包含输入文件指纹、时间范围、提示词、参考、模型与参数；UI 布局、混合强度、关键帧不改变摘要。
- 保存实际发给 Provider 的非秘密规范化输入，不只存 hash。
- UI 关闭不取消任务；重启先恢复原任务。首版单机顺序队列，不引入 Redis / 消息总线。
- 费用确认由执行代码校验；调用方传 `confirmed` 不等于已批准。

## 5. 素材版本

| 字段 | 说明 |
| --- | --- |
| 基本 | ID、来源任务、文件与校验和、尺寸、帧率 / 帧数、色彩与 Alpha（含预乘方式）、配方摘要 |
| `kind` | `overlay`（叠加层，不含源像素）或 `version`（整段新版本） |
| overlay 额外 | 源片段身份、源入点 / 出点、对齐偏移、建议混合模式、Draw 遮罩引用 |

- 先写暂存文件，校验后原子提交到持久目录（内容寻址）；文件齐全才标记完成。
- 引用只保存稳定 ID 与相对路径；不保存临时 URL、Blob URL、base64。
- 被工程引用的素材不自动清理；移动目录后提供重定位并校验内容。
- 统一用整数帧与有理帧率；首版只验证固定帧率 SDR，变速 / 倒放 / HDR / 超长片段未测前明确不支持。

## 6. 本地文件夹与浏览器导入

- 本地文件夹：引用语义（见 Canvas 模块）；使用云端模型时界面需说明原文件会发给供应商。
- 浏览器扩展导入：复制字节到内容寻址 Artifact Store（见 [15](15-web-community-extension.md)）。两者共用下游任务与素材能力。

## 7. 不做

第二份调度器（Rust 与 Node 各一套）；为单步效果强制 ProductionSpec / StageRun；云端生成中转；手写编解码器。

## 8. 已知缺口

- CLI → 宿主的同机二进制交接：当前 Workspace Adapter 为 JSON / SSE，请求体整体缓冲 36 MiB，不能运输大视频。
- 无 UI 独立启动 Runtime 与所有前端 Provider 等价，未完成。
- 稳定面尚未暴露 `task.inspect` / `task.resume` 与费用确认参数。

## 9. 验证

Provider resilience 与 wire 测试（Fake Provider 只证明协议）；真实 Provider 分别验证扣费、429、取消、unknown-submit；Runtime：`cargo test --manifest-path src-tauri/Cargo.toml`。
