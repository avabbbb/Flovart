# Flovart Agent Host Matrix

状态：E0 真实包/代码审计。Status 不是营销承诺；真实登录、客户端行为和发布认证单独记录。

| Agent Host | 目标 Transport | 当前仓库证据 | 当前状态 | 外部门槛 |
| --- | --- | --- | --- | --- |
| Codex | CLI + canonical Skill；可选官方 Plugin projection | `tools/flovart/ensure.js`、`agent-kit.js`、`.agents/skills/flovart/SKILL.md` | Experimental | 真实登录、从新会话完成 inspect/apply/run |
| Claude Code | CLI + canonical Skill | shared Skill/CLI registry | Experimental | 真实安装/登录 tracer |
| OpenCode | CLI + canonical Skill | shared Skill/CLI registry | Experimental | 真实 Host tracer |
| WorkBuddy | CLI Connector + Skill | `integrations/workbuddy/flovart/connector-meta.json`、`cli.json`、Skill | Experimental | 官方客户端导入、自然语言调用、客户端版本认证 |
| TeleAgent | MCP + canonical Skill | `tools/flovart/mcp-server.js`、`integrations/teleagent/README.md` | Experimental / External Gate | 核验最新 MCP 导入与 Skill 接口、真实客户端 tracer |
| DeepSeek Harness RC8 | Native Cordis Service + bounded tools | `dsh-plugin/src/service.ts`、`src/tools.ts`、`cordis.patch.yml` | Experimental | RC8 登录、service lifecycle、Browser Workflow tracer |
| CodeBuddy Code | CLI + Skill compatibility | host registry / shared Skill | Planned | 真实客户端和安装态 |
| Pi Coding Agent | CLI + Skill compatibility | host registry / shared Skill | Planned | 真实客户端和安装态 |

## Common rule

所有 Host 都调用同一稳定操作语义。Host Identity、Distribution Target、Runtime Binding 和 Workflow authority 是不同维度；不允许某个 Host 产生自己的 Workflow schema、Provider route 或秘密存储。

## WorkBuddy choice

WorkBuddy 第一版固定使用 CLI + Skill。其一个 Connector 不同时携带 MCP 与 CLI；若未来改用 MCP，应发布新的 Connector 变体并重新验证，不在现有包中偷偷混装。

## TeleAgent choice

TeleAgent 采用 MCP + Skill 已有本地 projection，但不是已认证事实。仍必须在真实 TeleAgent 客户端验证导入、权限、长任务等待和错误展示，未通过前保持 External Gate。
