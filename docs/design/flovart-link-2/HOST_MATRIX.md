# Flovart Link 2.0：Host 矩阵

`detected/available` 只表示本地发现或 package 存在，不等于已登录、可写或
经过第三方宿主认证。没有真实 tracer 的项目不得标 Stable。

## Agent Hosts

| Host | detected / installed | auth | projection / contract | write / real tracer | 当前口径 |
| --- | --- | --- | --- | --- | --- |
| Codex | PATH discovery + stable CLI/Browser surface | `not-inspected`；真实新会话未认证 | Codex Skill、Link ensure、Browser writer | lease/CLI contract tests；真实首次 Codex 对话 External Gate | Experimental |
| Claude Code | PATH discovery | `not-inspected` | shared Skill + CLI | 同一 surface；无独立 Workflow core，登录未认证 | Experimental |
| OpenCode | PATH discovery | `not-inspected` | shared Skill + CLI | 同一 surface；Host-specific login 未认证 | Experimental |
| Pi | registry compatibility target | 未认证 | shared Skill + CLI target | 无本机登录 tracer | Planned |
| CodeBuddy Code | PATH `codebuddy`/`cbc` probe | 未认证 | shared Skill + CLI target | 不与 WorkBuddy 合并；无真实 tracer | Planned |
| WorkBuddy | official-shape connector artifact；client/Marketplace 未提供 | local-ready semantics，不伪造 OAuth | `connector-meta.json` + `cli.json` + Skill | package/schema/clean fixture 通过；自然语言 client External Gate | Experimental |
| DeepSeek Harness | RC8 bundle/profile 可安装 | 真实账号未认证 | `@flovart/dsh-plugin`、`ctx.flovart`、五个 tools | profile install/`--dump-config` 通过；真实会话与 run External Gate | Experimental |

## Creative Hosts

| Host | package | selection/resource | import | 当前证据与口径 |
| --- | --- | --- | --- | --- |
| Photoshop | `dist-studio/photoshop`（manifest v4） | selected layer → `creative-host` locator → shared reference | Link-injected new layer callback | build、manifest、contract/mock 通过；真实 UXP/Provider/new-layer External Gate | Experimental |
| Premiere Pro | `dist-studio/premiere`（manifest v5，25.6+） | selected Project Item/current frame → shared reference | Link-injected Project import callback | build、manifest、clip/frame contract 通过；真实 UXP/import External Gate | Experimental |
| After Effects | `dist-studio/after-effects`（CEP） | selected layer → `creative-host` locator → shared reference | Link-injected CEP/ExtendScript layer bridge | package/CEP manifest/bridge contract 通过；真实 AE layer tracer External Gate | Experimental |
| DaVinci Resolve Studio | `dist-studio/resolve`（Workflow Integration） | selected clip → `creative-host` locator → shared reference | Link-injected Studio Workflow Integration Media Pool bridge | package/bridge contract 通过；真实 Studio clip/import tracer External Gate | Experimental |

## Link public status

| 内部情况 | 产品状态 |
| --- | --- |
| service、Browser、selected Host 和 writer ready | `ready` / 已就绪 |
| 未安装、未导入或 package 不存在 | `needs_setup` / 需要准备 |
| Host 明确报告 auth 缺失 | `needs_login` / 需要登录 |
| local service、Browser workspace 或必要连接不可用 | `offline` / 本地服务不可用 |

`SSE failed`、`401`、`clientId`、`writerClientId`、loopback port、projection path
等只允许在 Developer Diagnostics 出现。

## 官方边界资料

- [WorkBuddy Connector](https://open.workbuddy.cn/en/docs/connector)：CLI + Skill
  的 package shape、runtime 和 lifecycle 以开发时官方文档为准。
- [DeepSeek Harness Service model](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/service.md)：
  service 依赖消失时 dispose，恢复时重新注入，不能缓存 stale service。
- [Photoshop UXP design guidance](https://developer.adobe.com/photoshop/uxp/2022/design/ux-patterns/designingforphotoshop)：
  使用非阻塞、上下文型、可持续的 panel。
- [Premiere UXP plugins](https://developer.adobe.com/premiere-pro/uxp/plugins/)：
  Premiere 25.6+ 的 UXP panel 路线。
- [After Effects developer entry](https://developer.adobe.com/after-effects/)：
  panel、script 与 plug-in 能力按已安装版本和 CEP/ExtendScript bridge 验证。
- [DaVinci Resolve Workflow Integration](https://wheheohu.github.io/bmd_doc/workflow/WorkflowIntegration)：
  只按 Resolve Studio Workflow Integration 进行外部宿主验收，不宣称 free Resolve 原生面板。

真实 host 状态见根目录 [SUPPORT_MATRIX.md](../../../SUPPORT_MATRIX.md)。
