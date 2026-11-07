# @flovart/dsh-plugin 发布状态

状态日期：2026-11-07。每一档只写已有证据的结论。

| 阶段 | 状态 | 证据 / 阻塞 |
| --- | --- | --- |
| 本地安装通过 | 通过 | `npm pack --dry-run`：`@flovart/dsh-plugin@0.1.0`，7 个文件，40.4 kB（解压 138 kB）；干净 `DSH_HOME` 从包安装、`--dump-config`、重装不重复注册、卸载只移除 `profiles/flovart`；包内密钥扫描无命中 |
| 已发布包 | 未发布 | 本机 `npm whoami` 返回 ENEEDAUTH；`registry.npmjs.org` 上 `@flovart/dsh-plugin` 为 404；`flovart` npm 组织接口为 404（scope 未注册或不可见） |
| 已提交市场 | 未提交 | 依赖已发布包；此外未找到 DSH 0.1.0-rc.8 官方插件市场的提交入口或契约，社区渠道不等同官方收录 |
| 市场已收录 | 否 | — |

## 兼容集

- DeepSeek Harness：`@deepseek-ai/dsh@0.1.0-rc.8`（本机已安装版本）。
- 模型工具：`flovart_status`、`flovart_inspect`、`flovart_selection`、`flovart_apply`、`flovart_run`，对应 Flovart CLI 的五个稳定命令；付费、审批与媒体命令不在工具面。`flovart_run` 仍在 Flovart 画布里弹计划卡，由用户确认后才提交。
- 不兼容的 Harness（缺 `@deepseek-ai/dsh-tools`）时跳过工具注册，退回 Operation Skill + CLI，不阻塞 profile 启动。

## 发布步骤（需要维护者账号）

1. 在 npmjs.com 创建或确认 `flovart` 组织，并把发布账号加入。若不用该 scope，先把 `package.json` 的 `name` 改成可用名称，并同步 `scripts/profile.mjs` 与文档中的包名。
2. `npm login --registry https://registry.npmjs.org`（本机默认 registry 是镜像，发布必须显式指定官方地址）。
3. 在 `dsh-plugin/` 下：`npm run build`，再 `npm pack --dry-run` 核对为 7 个文件。
4. `npm publish --access public --registry https://registry.npmjs.org`。
5. 验证：`npm view @flovart/dsh-plugin version --registry https://registry.npmjs.org` 返回 `0.1.0`；然后在临时 `DSH_HOME` 里 `npm run profile:install -- --home <tmp> --package @flovart/dsh-plugin@0.1.0` 从 registry 安装。
6. 只有第 5 步通过，上表“已发布包”才改为通过。市场提交与收录单独记录链接和日期。

## 真实 DSH 会话验证（未完成）

本机 DSH profile 的 Agent 模型是 `deepseek-official / deepseek-v4-flash`，真实会话会产生付费 LLM 调用，本轮未运行。已用不调 LLM 的脚本 `node scripts/e2e-provider-trace.mjs dsh_three_shot` 按插件同一组 CLI 命令跑三镜头与“只改第二镜头”，它不等于 DSH Agent E2E。

2026-11-07 确定性脚本结果（fake provider，非 DSH Agent E2E）：`.tmp/e2e-trace/dsh_three_shot.json`，`ok: true`。3 个视频节点；三镜头只弹一张批量计划卡（“共 3 个节点 · 3 个任务 · 预估额度未知”），批量期间无第二张卡；首轮 3 次提交，三镜头均成功；改第二镜头提示词为“镜头 2：产品特写，换成暖色逆光”后只重跑镜头 2，合计 4 次提交；只用了 `status`、`workflow.inspect`、`workflow.apply`、`workflow.node.run`；trace 中无 Key。费用：未测量。

放行付费调用后，在干净 profile 里手动验证：

1. `npm run dsh:profile:install`，然后 `npm run dsh:start`，确认 DSH 页面出现 Flovart 面板且状态为已连接。
2. 对 Agent 说：“在当前画布建一个三镜头产品视频工作流，每个镜头一个视频节点，先不要运行。”核对画布出现 3 个视频节点。
3. 说：“运行这三个镜头。”核对画布只弹一张计划卡，确认后供应商记录 3 次提交。
4. 说：“只把第二个镜头改成暖色逆光并重新生成。”核对只有镜头 2 的提示词与任务 ID 变化，镜头 1、3 不变，合计 4 次提交。
5. 导出 DSH 会话 JSONL（`$DSH_HOME/sessions`）存档，并检查其中没有 API Key。
