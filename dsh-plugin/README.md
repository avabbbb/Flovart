# @flovart/dsh-plugin — DeepSeek Harness Flovart Plugin

> 当前兼容集：DeepSeek Harness `0.1.0-rc.8`、Node `^22.19.0 || >=24.0.0`。
> 当前仓库已验证 packed profile 安装、`--dump-config`、Host/Client 构建与 Cordis service lifecycle contract；真实登录会话、真实 Harness 页面 tracer 和发布升级回滚仍需单独放行。

## 用户路径

1. 在仓库根目录运行 `npm run dsh:start`。
2. 启动器准备 Workspace Operator，并通过 Flovart Link 确保可见 Browser Workflow，再启动 `flovart` Harness Profile。
3. 在 DeepSeek 主会话中切换到 `Flovart` 页签。
4. 查看当前可见 Workflow；修改和生成由 `ctx.flovart` tools 继续走同一条 Flovart Core 链路。

用户不需要填写 Runtime 地址或 Token，也不需要理解 Browser binding。DeepSeek 主对话是指挥入口，Flovart 页签只承载当前可见 Workflow、制作状态和产物摘要；没有可见 Browser Workflow 时会明确提示，不创建隐藏副本。

## 组成

| 部分 | 职责 |
| --- | --- |
| `cordis.patch.yml` | 向专用 Profile 插入一个 `flovart` Host/Client 行 |
| `src/index.ts` | 提供 CLI 工具派生与受限 Workspace 同源代理 |
| `src/client/` | 注册上下文 `conversation.view` 与 `shell.overlay` |
| `scripts/build.mjs` | 构建 Host ESM 与 RC8 `__ModuleLoader__` Client bundle |
| `scripts/profile.mjs` | 安装、诊断、启动 Profile，并管理 Workspace Operator 生命周期 |
| `assembly.json` | 锁定兼容集和隐私边界 |

## RC8 边界

- 不占用根 `sidebar`、`conversation` 或 `conversation.session`。
- 不注册额外侧栏入口，不使用 iframe，也不把用户带进第二套 Agent/聊天页面。
- 浏览器只访问 Harness 同源的 `/flovart-workspace`；Host 仅代理 `health` 与受限的 Workflow tools 路由。
- Workspace Token 只存在于启动器环境和 Harness Host，不序列化到浏览器，不进入节点、Draft、回执或 Provider 参数。
- Provider、付费 Production Gate、Task/Event 与 Artifact 权威边界保持不变。

## 构建、安装与启动

从仓库根目录：

```bash
npm run dsh:profile:install
npm run dsh:start
```

包内诊断：

```bash
npm run build
npx tsc --noEmit
npm run profile:doctor
npm run profile:start
npm run profile:uninstall -- --home <temporary-or-user-dsh-home>
```

`profile:install` 会生成 `$DSH_HOME/profiles/flovart`，按
`@deepseek-ai/dsh-base → @deepseek-ai/dsh-web-app → @flovart/dsh-plugin`
组合 Profile，并通过 `--dump-config` 校验安装结果。`profile:start` 先通过同一个
`flovart ensure --json` 复用/启动可见 Web Workflow，再使用随机可用端口启动
Harness；Harness 退出时一并停止由本次启动创建的 Workspace Operator。若没有可见
Browser Workflow，DSH view 会 fail closed，不创建隐藏副本。

## 当前验证证据

- `profile:install` 已真实完成 bundle 安装、版本/loader 校验和 `--dump-config`；`profile:start` 的真实登录态与宿主页面认证仍是 External Gate。
- RC8 Client/Host bundle、Slot 声明和同源代理契约可构建并通过测试；这不替代真实 RC8 页面与账号会话证据。
- 当前 view 只读显示可见 Browser Workflow；不会预造空项目、保存 Native Draft 或绑定第二份 Workflow。
- 真实浏览器已完成 RC8 Profile 页面 smoke，无页面异常或控制台错误；完整 Production Brief 对话仍受本机 DeepSeek 登录态限制，未用付费凭据冒充通过。
- DSH service 的 Workflow API 总是把 `workspaceMode` 固定为 `browser`；没有可见 Browser Workflow 时返回 `WORKSPACE_REQUIRED`/`WORKSPACE_UNAVAILABLE`，没有 silent fallback 或假执行。
- Workspace Operator 被精确终止后，Supervisor 已真实以相同 loopback 会话重新拉起；Cordis service 的临时 CLI lifecycle test 已证明依赖 disposer 会卸载，服务恢复后重新注入。
- `profile:uninstall` 已真实验证只移除 `$DSH_HOME/profiles/flovart`，保留 DSH_HOME 其余内容、Workspace 数据和其他 Harness Profile。
- Host/Client TypeScript、bundle loader 契约、同源代理白名单、稳定五工具派生和定向 UI/Store 测试均通过。

## 仍需放行验证

1. 在真实 DeepSeek 登录态下确认 Harness 页面重载后仍能读取并操作可见 Browser Workflow，并保存页面/会话证据；当前本机无登录态，不能冒充完成主对话验收。
2. 不兼容升级的原子回滚、插件禁用后的 CLI-only 路径与发布态升级回归。
