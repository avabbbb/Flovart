# Iris Support Matrix

这份矩阵是当前仓库证据的发布口径，并冻结 Closed Beta 范围：只有 `Beta`
级别的集成是本次发布主推路径；`Experimental` 集成可用但未认证，不得在
onboarding 或宣传中呈现为与 Beta 路径同等就绪。`Stable` 只表示本地可重复
验证的契约或能力，`Beta` 只表示发布主推路径，两者都不等同于第三方登录、
真实付费 Provider、宿主安装或公开发布认证。

## Agent hosts

| Host / projection | Status | Evidence / boundary |
| --- | --- | --- |
| Codex CLI + Browser Workflow | Beta | 本次发布主推的 Agent 路径。Link/Lease focused tests、Chrome for Testing smoke 与 5 次连续真实 `codex exec`（v0.154.0）trial：Codex 读取 `.agents/skills/flovart/SKILL.md` 后经 CLI 驱动真实 Browser Workflow 完成 3 节点 + 2 顺序连接（`workflow.node.create-connected`，trial 3–7）。**脱敏证据已入库：`docs/evidence/release-candidate/CODEX_TRIAL_EVIDENCE.md`**；真实 Provider wire 进行中，公开安装首次启动 transcript 仍是 External Gate |
| Claude Code CLI projection | Experimental | shared Skill/CLI surface；真实登录与公开安装态未认证 |
| OpenCode CLI projection | Experimental | shared Skill/CLI surface；Host-specific tracer 未认证 |
| DeepSeek Harness RC8 bundle/profile | Experimental | DSH build、service/tool tests、packed profile install 与 `--dump-config`；真实登录、可见 Browser Workflow tracer、service recovery 仍待认证 |
| WorkBuddy CLI Connector + Skill | Experimental | official-shape artifact、schema/secret/clean fixture 与 local-ready lifecycle；真实 WorkBuddy client/Marketplace/NL tracer 未运行。Closed Beta 不作为主推路径 |
| TeleAgent MCP + Skill projection | Experimental | stdio MCP handshake/tool/resource contract 与接入准备包；真实 TeleAgent client/import/NL tracer 未运行 |
| CodeBuddy Code | Planned | stable Skill/CLI compatibility target；无本机登录 tracer |
| Pi | Planned | stable Skill/CLI compatibility target；无本机登录 tracer |

## Creative hosts

| Host | Status | Evidence / boundary |
| --- | --- | --- |
| Photoshop UXP panel | Experimental | `npm run studio:build`、manifest v4、shared `CreativeHostAdapter` 与 layer contract/mock tests；真实 UXP layer → I2I → new layer 是 External Gate |
| Premiere Pro UXP panel | Experimental | `npm run studio:build`、manifest v5 / 25.6+、clip/frame contract/mock tests；真实 UXP → artifact → Project import 是 External Gate |
| After Effects | Experimental | 当前轻面板为 `dist-studio/after-effects` CEP/ExtendScript bridge；planned native effect 为独立 C++ Effect SDK 路径。不得假设 AE 已有可发布 UXP host；两条路径均需独立真实宿主认证 |
| DaVinci Resolve Studio 21.1 | Experimental | **当前第一宿主方向**：优先验证 Blackmagic native MCP + Iris Skill / legacy `flovart` CLI；`dist-studio/resolve` Workflow Integration 降为轻面板 / measured fallback，planned OFX 独立后置。真实 native MCP 连接、selection → durable artifact → Media Pool tracer 仍是 External Gate |

## Native effects and deeper Agent integration

The following are design targets, not capabilities certified by the panel or MCP tests above. All creative hosts stay `Experimental` for Closed Beta — none is a certified install path. The initial native-effect release targets Windows; macOS will be validated separately and is not a simultaneous-release commitment.

| Capability | Status | Required evidence |
| --- | --- | --- |
| AE / PR native Flovart effects | Planned | Real effect controls, fixed media versions, keyframes, saved project and offline export |
| Photoshop native filter | Planned | Real filter integration, selection, editable parameters and project reopening |
| Resolve OpenFX effect | Planned / deferred | 仅在 MCP-first 真实流程证明需要 fixed-version effect parameters / keyframes / offline effect rendering 后启动；需独立 Real OFX evidence |
| Native-effect generation without an open Workflow | Proposed | Confirm scope; verify headless service, Provider parity and persistent assets |
| Internal Codex / WorkBuddy task entry | Planned | Official integration, real account, visible conversation, tools, approval and recovery |

Scope and proposed benchmarks are defined in the [main design](docs/design/flovart-native-effects.md).

## Runtime and provider paths

Closed Beta 只认证一条付费 Provider 路径：RunningHub 图片 + 视频（Route
Catalog 驱动的标准模型线路）。它是本 release 唯一可走认证流程的 Provider
path，认证完成前其发布状态仍为 `Beta (pending certification)`；其余
Provider 一律 `Experimental` / unverified，不得写进 Beta 发布口径。

| Capability | Status | Evidence / boundary |
| --- | --- | --- |
| Stable CLI surface (`status`, `ensure`, `workflow.inspect`, `workflow.selection.get`, `workflow.apply`, `workflow.node.run`) | Stable contract | registry/CLI/Skill tests；命令仍通过既有 Workspace Adapter 与 Workflow authority |
| Browser-bound Workflow authority | Stable contract | 无 Browser workspace 时结构化返回 `WORKSPACE_UNAVAILABLE`，不回退随机项目或 last-focused project |
| Workspace Lease | Experimental | acquire/validate/renew/release/expire、cross-project、close、revision 和 idempotency focused tests；未完成 20x chaos/持久化压力证据 |
| ProductionTask v1 projection | Experimental | `task.inspect` / safe `task.resume` over durable ProductionRun/StageRun and scheduler lease；真实 Agent 跨会话、429/提交未知恢复与 Task Center 未认证 |
| Local Fake Provider HTTP fixture | Stable test fixture | Provider resilience 与 wire tests；不代表第三方账号/账单行为 |
| RunningHub image + video routes | Beta (pending certification) | 唯一进入认证流程的 Provider path：Schema 驱动 Route Catalog（18 条认证候选线路）+ 真实付费 trial capture（seedream t2i、seedance i2v、restart-after-submit）；真实账号、扣费与恢复语义的认证 gate 见下文 External Gate |
| OpenAI-compatible BYOK | Experimental / unverified | 本地 Fake Provider + Browser/Workflow path；真实供应商、价格、取消语义待认证，Closed Beta 不作发布承诺 |
| Seedance direct / other remote providers | Experimental / unverified | route/adapter 存在；真实账号、账单和生产失败语义未验证，Closed Beta 不作发布承诺 |

## Extensions and packages

| Package | Status | Boundary |
| --- | --- | --- |
| `dist-workbuddy/flovart` | Experimental artifact | 可生成并校验；需 WorkBuddy client/Marketplace certification |
| `dist-studio/photoshop` | Experimental artifact | 可生成并校验；Link 注入的 materialize/import/controller 尚未在真实 Photoshop 运行 |
| `dist-studio/premiere` | Experimental artifact | 可生成并校验；Link 注入的 frame/import/controller 尚未在真实 Premiere 运行 |
| `dist-studio/after-effects` | Experimental artifact | CEP/ExtendScript light-panel artifact；真实 AE layer tracer 尚未认证，且不代表 C++ native effect |
| `dist-studio/resolve` | Experimental artifact | Resolve Studio Workflow Integration artifact；真实 Media Pool tracer 尚未认证，且不代表 OFX effect |
| `@flovart/dsh-plugin` | Experimental | RC8 profile 可安装；真实认证会话与完整 recovery 未完成 |
| `tools/flovart/mcp-server.js` / `flovart-mcp` | Experimental artifact | canonical five-tool stdio projection 与 MCP SDK tests；真实 MCP Host import、Agent session 与 Provider path 未认证 |
| Built-in Workflow node plugins | Experimental | trusted in-process code，故障隔离不是安全 sandbox |
| Community Skill package install | Experimental | 安装边界有路径/大小/数量/重复项校验，第三方包安全仍需签名与权限策略 |

## Release gates still outside autonomous evidence

- 真实 Codex 登录和从公开安装包首次启动的完整 transcript；
- WorkBuddy 真实客户端/Marketplace 安装与自然语言 tracer；
- DSH 真实用户登录、可见 Browser Workflow tracer、service unload/reload；
- Photoshop、Premiere 的真实宿主安装、选择、Provider wire、artifact import；
- After Effects 的真实宿主 API / 安装 gate；Resolve Studio 21.1 的 native MCP 真实连接、Agent selection tracer、durable artifact → Media Pool 导入与 panel UX；
- RunningHub 真实账号付费路径的认证 gate：seedream t2i / seedance i2v /
  restart-after-submit 三次真实付费 trial 的 capture、扣费与恢复语义复核
  （完成后该行才从 `Beta (pending certification)` 升级为认证路径）；
- Hosted CodeQL、dependency review、secret scanning/push protection、生产 updater
  signing、Windows Authenticode 和 GitHub Release publication。

README、onboarding 与产品宣传不得把 `Experimental` / `Planned` / `Beta (pending
certification)` / External Gate 写成已认证的 Stable 能力；Closed Beta 只主推
Codex Agent 路径与 RunningHub Provider 路径。
