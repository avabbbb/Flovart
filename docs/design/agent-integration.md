# Iris Agent Integration

> Current design. 本文只定义 Agent 接入与操作边界；产品 IA 以 [主设计](./flovart-native-effects.md) 为准。

## 1. 两个不同概念

**Agent surface** 是顶栏的连接中心：发现、准备、查看状态、切换 Codex / WorkBuddy 等本地或外部 Coding Agent。

**Assistant drawer** 是 Canvas / Table 右侧的内置上下文助手：对当前项目对话并调用受控操作。

二者不能互相复制 UI、会话、Host picker 或状态。

## 2. 稳定操作面

模型日常以五个稳定操作为 baseline：

- `status`
- `workflow.inspect`
- `workflow.selection.get`
- `workflow.apply`
- `workflow.node.run`

连接准备与诊断使用 `ensure` / `doctor`。更细的兼容 helper 可以存在；只有 canonical Skill 明确需要它来弥补当前 stable operation 的表达缺口时才教给 Agent，并且仍走同一 mutation/authority 边界。它不能演变成第二套 Agent-facing 产品 surface。

## 3. Transport

| Transport | 角色 |
| --- | --- |
| CLI + Agent Integration Skill | 默认外部 Agent 路径 |
| stdio MCP | 同一 operation contract 的可选投影 |
| 内置 Assistant | 同一业务能力的 UI 入口 |
| Host/native adapter | 只在对应宿主真实接口存在时使用 |

Transport 只做参数解码、权限上下文与结果编码。业务逻辑不能复制到 transport。

## 4. 权威与安全

- Workflow mutation 绑定明确 project/revision。
- 重试使用稳定 idempotency identity。
- 未知提交先查询，不盲目重发可能计费的请求。
- Agent 工具权限与 Provider 费用授权分开。
- Skill、日志、连接状态与项目数据不携带 Provider 原始 key。
- 外部 Agent 不直接写 React store、local storage schema 或 Runtime 私有数据库。
- 一个 Host 的连接失败不能阻塞其它 transport。

## 5. Host 状态语义

面向普通用户只展示可行动状态，例如：

- 已准备
- 需安装
- 需登录
- 离线
- 异常

内部 Writer、Projection、URL、Token、协议版本等只放高级诊断。

“已准备”只代表 Iris 已完成本地准备，不代表真实第三方会话、登录、权限或自然语言任务已经通过。

## 6. 当前不采用

- Agent full-page chat / task / artifact workspace；
- Production Crew / Director / Operator 的强制分层；
- Host-specific Workflow store；
- MCP → CLI subprocess forwarding；
- 连接中心和 Assistant drawer 同时维护 Host picker；
- 跨 Agent 隐藏上下文/登录态无损迁移。

## 7. 验证

真实支持状态只看 [Support Matrix](../../SUPPORT_MATRIX.md)。至少分别验证：

- 安装/发现；
- 登录态；
- inspect；
- mutation；
- node.run；
- 断线恢复；
- 错项目保护；
- Provider 费用与取消（如果任务会生成）。

### 7.1 Agent 评测口径

复用 `eval/` harness，按证据来源分别报告：受控环境中的确定性 operation、真实外部 Agent、真实 Browser 最终状态与真实 Provider/宿主结果。确定性 reference replay 和 transcript 写操作回放不能替代独立的真实最终状态校验，也不能贡献真实 Agent E2E 认证。

`pass@1` 的分母为已执行 trial；blocked、已知缺口和 surface 不适用项另列。`pass^5` 按 task × runner 分组，只有完整执行 trial 1–5 的组才进入分母；不足五次、重复 trial 或含 blocked 的组列为 incomplete。没有完整组时记未测，不报告 0% 或 100%。同时展示完整组/总组，避免只看可执行子集的高分。其它重复次数不冒充五次可靠性；各维度不压缩成一个总分。

错目标写入、未经授权付费、重复提交、密钥泄漏和错误版本应用保持安全硬门槛；被系统拦截的尝试单列。受控环境零事件不证明真实账号和宿主零风险。正式支持等级仍只由 Support Matrix 的对应现实证据决定。

每个 bad case 保留预期/实际、脱敏轨迹与最终状态、版本、影响、首个偏离点、根因证据、漏检原因、负责人和关闭条件。根因区分 Agent、产品、环境、外部服务、任务定义、评分器或未知。每例记录分诊；严重安全事件单独复盘，同根因普通失败合并。修复后验证原例、同族变体和正常任务，跟踪复发；已知回归改善不能代替独立任务集的泛化验证。

历史 CLI/MCP/DSH 目标架构与 projection audit 已归档，不再作为并列产品设计。
