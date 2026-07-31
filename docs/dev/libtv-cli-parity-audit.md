# LibTV CLI 功能复刻审计

## 结论

Flovart **没有完美复刻 LibTV CLI 1.1.1**。

两者已经共享“Agent 操作可见画布、节点和生成能力”这条主干，但还不是命令、数据模型或运行语义上的等价实现。Flovart 当前优势是本地 Runtime、持久 Task/Event、Provider-neutral Route、预算与审片 Gate；LibTV 当前优势是完整的画布 CLI 操作面、分组、媒体上传下载、模型 Schema、同步节点运行和可组合管道。

因此更准确的产品表述是：

> Flovart 已实现独立的 Agent-first 制作架构，并复刻了 LibTV 的部分 Agent→画布核心交互；尚未实现 LibTV CLI 的完整功能对等。

## 审计基线

- LibTV：本机实际安装的 `libtv 1.1.1`。以 `libtv --help` 和各子命令 `--help` 为准。
- LibTV 官方产品面：[CLI 安装与 Agent 接入](https://www.liblib.tv/cli)、[专业视频创作产品页](https://www.liblib.tv/wappro?sourceid=040004)。
- LibTV 官方开源面：[libtv-labs/libtv-skills](https://github.com/libtv-labs/libtv-skills)。
- Flovart：`0.3.0` 的 Canonical Command Registry。当前共 56 条登记命令，其中 34 条为 `available`、22 条为 `legacy-only`。

审计只把 `available` 命令算作 Agent 可依赖能力。`legacy-only`、仅有 UI 按钮、仅有类型定义或仅有设计文档，都不会被记成 CLI 已交付。

## 功能矩阵

| 能力 | LibTV CLI 1.1.1 | Flovart 当前实现 | 判定 |
| --- | --- | --- | --- |
| Agent 安装与接入 | CLI Skill、登录、面向多种 Agent | Skill、CLI、MCP、Managed Agent；安装命令仍标为 legacy-only | 部分等价 |
| 账户与团队作用域 | 登录/登出、多账户、个人/团队切换 | 本地 Provider 配置，没有 LibTV 账户/团队作用域 | 不同产品路线 |
| Workspace → 多画布层级 | workspace 下容纳多张 project 画布 | 单层本地 Workflow Project | 缺失 |
| 目录绑定 | `.libtv/project.json` 绑定 workspace/project/group | WebUI 当前项目选择，没有同语义的目录绑定层级 | 缺失 |
| 画布项目管理 | create/list/update/use/unuse/summary | list/create/use/delete/inspect | 部分等价 |
| 节点类型 | text/image/video/audio/group/script/video-clip | UI 类型含 image/text/video/audio/config/script；Canonical create 只开放 image/text/video/audio/config | 部分等价 |
| 节点 CRUD 与几何 | 查询、创建、更新、删除、坐标 | 创建、更新、删除、移动、缩放、选择 | 核心等价 |
| 连线 | ensure/add/remove 左右边，支持管道补边 | connect/disconnect、create-connected | 部分等价 |
| 普通分组 | create/list/use/unuse、绑定/解绑节点、分组运行 | 没有 Canonical group 命令 | 缺失 |
| 模型发现与 Schema | live search，按模型返回完整 `tool_spec` | model list/search 仅 legacy-only；Route Catalog 不等于 Agent 可查询的完整 Schema | 缺失 |
| 节点同步运行 | `node --run` 阻塞至终态 | `workflow.node.run` 为 legacy-only；生成改走 `generate.image/video` 或 ProductionRun | 部分等价 |
| 分组批量运行 | `group --run` | 没有 | 缺失 |
| 本地媒体上传 | 图片/视频/音频上传并创建资源节点 | Workflow UI 支持本地拖入；Canonical CLI 没有 upload | 部分等价 |
| 节点/分组下载 | 单媒体直存、多文件 ZIP、去水印/会员语义 | 没有 Canonical 节点下载命令；项目导出不是同一语义 | 缺失 |
| 图片 Slash 快捷 | 可枚举并对源图节点执行，包括九宫格 | Workflow UI 有 SlashMenu、九宫格与分镜拼图；CLI 不可枚举或执行 | 部分等价 |
| 脚本转分镜 | 从 script 节点创建 group，并顺序生成分镜图 | UI 有 script 数据与分镜工具，Production Skill 能编译计划；没有同语义 Canonical 命令 | 部分等价 |
| 视频剪辑节点 | `video-clip` 节点与相关时间线数据 | Table 主体仍是占位，Canonical Workflow 无 video-clip | 缺失 |
| NDJSON/标准输入管道 | 节点 JSON 可逐行串联下游命令 | CLI 支持 JSON 输出和 TUI，但没有 NDJSON 节点链 | 缺失 |
| 自然语言 Agent 会话 | 官方 OpenAPI Skill 提供会话、进度轮询、上传与结果下载 | 内置 PI Agent 有可恢复主会话、15 条可见 Workflow 类型化工具和工具进度事件；文本 Route 需先配置，上传/下载与 Production 授权卡仍未闭环 | 部分等价 |
| 持久任务、审批与预算 | CLI 运行侧重画布同步等待 | Durable Task/Event、ProductionRun DAG、Route/预算 Gate | Flovart 更强且不同 |

## 为什么不能叫“完美复刻”

“完美复刻”至少需要同时满足四项：

1. **命令对等**：同一类操作都能从 Agent/CLI 入口调用。
2. **数据对等**：workspace、project、group、node type 和模型参数有可映射模型。
3. **语义对等**：运行、等待、错误、下载和管道组合的行为一致。
4. **可验证对等**：每项能力有 schema、实现、契约测试和真实画布验证。

Flovart 目前只在可见项目、基础节点图操作和图像/视频生成原语上形成了强对等；分组、模型 Schema、上传下载、脚本分镜、video-clip 与管道仍不满足前三项。

## 不应照抄的部分

LibTV 的账户、团队、云画布和社区属于其云产品边界。Flovart 当前的本地 Workflow、浏览器本地业务数据、操作系统 Keyring 和 Provider-neutral Runtime 是自己的产品选择，不应为了命令表相似而引入第二套状态权威。

如果补齐 Agent 操作面，命令应落到现有深模块：

- Workspace Adapter：project/group/node/edge/viewport。
- Production Runtime：run/task/artifact/upload/download/model capability。
- Production Skill：image shortcut、script→storyboard 等高层编译，不再引入新的 Director 命名。
- CLI/MCP：只做参数解析和协议转发，不保存 shadow state。

## 建议优先级

### P0：先补 Agent 真正缺的闭环

1. 把 `workflow.node.run` 升为 Canonical `available`，统一接入 Runtime Task，而不是恢复浏览器旧执行面。
2. 增加 Artifact 导入/导出命令：本地媒体→资源节点、Artifact/节点→本地文件。
3. 开放可查询的 Product Model Capability Schema，供 Agent 在提交前验证参数。
4. 增加 group 数据模型与最小命令：create/list/add/remove/run。

### P1：补制作效率

1. 将现有 Workflow Slash 能力暴露为可枚举、可执行的 Production Skill/Canonical 命令。
2. 将 script→storyboard 作为 tracer bullet：脚本节点、分镜组、顺序 StageRun、结果回填。
3. 为 CLI 增加 NDJSON 输入输出，使节点创建、连线和运行可安全组合。

### P2：先做产品决策再实现

- `video-clip` 与时间线应落到 Table 还是 Workflow。
- 是否需要团队账户、云 Workspace 和目录绑定。
- 是否追求 LibTV 命令兼容，还是只追求能力覆盖并保持 Flovart 自己的命名。

## 复核命令

```powershell
libtv --version
libtv --help
libtv node --help
libtv node create --help
libtv group --help
libtv model --help
libtv upload --help
libtv download --help
libtv image --help
libtv script --help

npm run flovart:cli -- command.list --json
npm run flovart:cli -- command.schema --command workflow.node.create --json
npm run flovart:cli -- command.schema --command generate.image --json
npm run flovart:cli -- command.schema --command production.dry-run --json
```

## 开源边界

官方公开仓库中的 `libtv-skills` 使用 MIT License，开源的是 Agent OpenAPI Skill 及其会话、上传、轮询和下载脚本。官方 CLI 页面分发的是已编译的 `libtv` 可执行文件；在 LibTV 官方 GitHub 组织当前公开仓库中没有找到该 CLI 或 LibTV 产品主体的实现源码。因此可以确认 **Skill 开源**，但不能据此宣称 **LibTV CLI 或产品主体开源**。
