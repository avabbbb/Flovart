# Flovart Support Matrix

这份矩阵是当前仓库证据的发布口径。`Stable` 只表示本地可重复验证的契约或
能力，不等同于第三方登录、真实付费 Provider、宿主安装或公开发布认证。

## Agent hosts

| Host / projection | Status | Evidence / boundary |
| --- | --- | --- |
| Codex CLI + Browser Workflow | Experimental | Link/Lease focused tests 与 Chrome for Testing smoke；真实首次 Codex conversation 仍是 external gate |
| Claude Code CLI projection | Experimental | shared Skill/CLI surface；真实登录与公开安装态未认证 |
| OpenCode CLI projection | Experimental | shared Skill/CLI surface；Host-specific tracer 未认证 |
| DeepSeek Harness RC8 bundle/profile | Experimental | DSH build、service/tool tests、packed profile install 与 `--dump-config`；真实登录、可见 Browser Workflow tracer、service recovery 仍待认证 |
| WorkBuddy CLI Connector + Skill | Experimental | official-shape artifact、schema/secret/clean fixture 与 local-ready lifecycle；真实 WorkBuddy client/Marketplace/NL tracer 未运行 |
| TeleAgent MCP + Skill projection | Experimental | stdio MCP handshake/tool/resource contract 与接入准备包；真实 TeleAgent client/import/NL tracer 未运行 |
| CodeBuddy Code | Planned | stable Skill/CLI compatibility target；无本机登录 tracer |
| Pi | Planned | stable Skill/CLI compatibility target；无本机登录 tracer |

## Creative hosts

| Host | Status | Evidence / boundary |
| --- | --- | --- |
| Photoshop UXP panel | Experimental | `npm run studio:build`、manifest v4、shared `CreativeHostAdapter` 与 layer contract/mock tests；真实 UXP layer → I2I → new layer 是 External Gate |
| Premiere Pro UXP panel | Experimental | `npm run studio:build`、manifest v5 / 25.6+、clip/frame contract/mock tests；真实 UXP → artifact → Project import 是 External Gate |
| After Effects | Experimental | `dist-studio/after-effects` CEP panel 与 Link-injected layer bridge；真实 AE tracer 仍是 External Gate |
| DaVinci Resolve Studio | Experimental | `dist-studio/resolve` Workflow Integration panel 与 Link-injected Media Pool bridge；真实 Studio tracer 仍是 External Gate |

## Runtime and provider paths

| Capability | Status | Evidence / boundary |
| --- | --- | --- |
| Stable CLI surface (`status`, `ensure`, `workflow.inspect`, `workflow.selection.get`, `workflow.apply`, `workflow.node.run`) | Stable contract | registry/CLI/Skill tests；命令仍通过既有 Workspace Adapter 与 Workflow authority |
| Browser-bound Workflow authority | Stable contract | 无 Browser workspace 时结构化返回 `WORKSPACE_UNAVAILABLE`，不回退随机项目或 last-focused project |
| Workspace Lease | Experimental | acquire/validate/renew/release/expire、cross-project、close、revision 和 idempotency focused tests；未完成 20x chaos/持久化压力证据 |
| ProductionTask v1 projection | Experimental | `task.inspect` / safe `task.resume` over durable ProductionRun/StageRun and scheduler lease；真实 Agent 跨会话、429/提交未知恢复与 Task Center 未认证 |
| Local Fake Provider HTTP fixture | Stable test fixture | Provider resilience 与 wire tests；不代表第三方账号/账单行为 |
| OpenAI-compatible BYOK | Experimental | 本地 Fake Provider + Browser/Workflow path；真实供应商、价格、取消语义待认证 |
| Seedance / RunningHub / other remote providers | Experimental | route/adapter 存在；真实账号、账单和生产失败语义未列为 Stable |

## Extensions and packages

| Package | Status | Boundary |
| --- | --- | --- |
| `dist-workbuddy/flovart` | Experimental artifact | 可生成并校验；需 WorkBuddy client/Marketplace certification |
| `dist-studio/photoshop` | Experimental artifact | 可生成并校验；Link 注入的 materialize/import/controller 尚未在真实 Photoshop 运行 |
| `dist-studio/premiere` | Experimental artifact | 可生成并校验；Link 注入的 frame/import/controller 尚未在真实 Premiere 运行 |
| `dist-studio/after-effects` | Experimental artifact | 可生成并校验；CEP/ExtendScript bridge 与真实 AE layer tracer 尚未认证 |
| `dist-studio/resolve` | Experimental artifact | 可生成并校验；Workflow Integration bridge 与真实 Studio Media Pool tracer 尚未认证 |
| `@flovart/dsh-plugin` | Experimental | RC8 profile 可安装；真实认证会话与完整 recovery 未完成 |
| `tools/flovart/mcp-server.js` / `flovart-mcp` | Experimental artifact | canonical five-tool stdio projection 与 MCP SDK tests；真实 MCP Host import、Agent session 与 Provider path 未认证 |
| Built-in Workflow node plugins | Experimental | trusted in-process code，故障隔离不是安全 sandbox |
| Community Skill package install | Experimental | 安装边界有路径/大小/数量/重复项校验，第三方包安全仍需签名与权限策略 |

## Release gates still outside autonomous evidence

- 真实 Codex 登录和从公开安装包首次启动的完整 transcript；
- WorkBuddy 真实客户端/Marketplace 安装与自然语言 tracer；
- DSH 真实用户登录、可见 Browser Workflow tracer、service unload/reload；
- Photoshop、Premiere 的真实宿主安装、选择、Provider wire、artifact import；
- After Effects、Resolve/Resolve Studio 的真实宿主 API、安装和 tracer；
- 真实 Provider 账号、价格、扣费、取消和服务条款行为；
- Hosted CodeQL、dependency review、secret scanning/push protection、生产 updater
  signing、Windows Authenticode 和 GitHub Release publication。

README 与产品宣传不得把 `Experimental` / `Planned` / External Gate 写成已认证的
Stable 能力。
