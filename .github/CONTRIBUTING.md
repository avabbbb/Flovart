# Flovart 贡献约定 | Contributing

[中文](#中文) · [English](#english)

## 中文

感谢参与 Flovart。为了让讨论和审查保持低成本，我们采用：

> 一个 Issue 只描述一个可判断的问题；一个 PR 只交付一个可验证的目标。

### 提 Issue

提交前先搜索已有 Issue，并从 [Issue 选择页](https://github.com/avabbbb/Flovart/issues/new/choose) 选择 Bug 或功能建议模板。

- 先说明用户遇到的问题和场景，再提出方案；
- Bug 必须包含最小复现步骤、预期结果、实际结果和环境；
- 功能建议必须写清用户路径、范围、非目标和验收标准；
- 架构级变化先开 Issue 讨论，不直接提交大规模重写；
- 不得粘贴 API Key、Token、私有 URL、带签名链接、Prompt、私人素材或未脱敏日志。

### 提 Pull Request

1. Fork 仓库并从最新 `main` 创建分支：`feat/<topic>`、`fix/<topic>`、`docs/<topic>` 或 `chore/<topic>`。
2. 在 PR 描述中使用 `Closes #123` 关联 Issue；纯文档拼写修正可写 `N/A` 并解释。
3. 写清“改了什么”“明确没改什么”和潜在风险，不顺手重构无关文件。
4. UI 变更附前后截图或短视频；交互变更写出人工验证路径。
5. 至少运行与改动直接相关的测试；通常应执行：

   ```bash
   npm install
   npm run test
   npm run build
   ```

6. 若只跑了定向测试，列出命令，并说明未运行全量检查的原因。
7. 功能状态变化同步检查 `docs/content/docs/progress/todo.mdx` 与 `pending-test.mdx`。

### 审查边界

- 产品只有 **Workflow、Table、Agent** 三个正式部分，不恢复旧 Canvas / Art。
- Provider 与 API 请求适配放在根目录 `services/`；共享状态优先使用现有 store/hook。
- 当前项目、素材和生成记录主要保存在浏览器本地，不把未实现的云同步写成正式能力。
- 新增遥测、外部请求、Secret 读取、持久化字段或费用路径时，PR 必须单独说明数据与安全影响。
- 提交信息建议使用 `feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`chore:` 等 Conventional Commit 前缀。

合并前，PR 应满足：范围清楚、Issue 可追溯、验证证据充分、文档状态真实、没有泄露凭据。

## English

Thank you for contributing to Flovart. We keep collaboration predictable with one rule:

> One Issue describes one decidable problem; one PR delivers one verifiable outcome.

### Issues

Search existing Issues first, then use the [Issue chooser](https://github.com/avabbbb/Flovart/issues/new/choose).

- Describe the user problem and context before proposing a solution.
- Bugs need minimal reproduction steps, expected behavior, actual behavior, and environment.
- Feature proposals need a user journey, scope, non-goals, and acceptance criteria.
- Discuss architecture-level changes in an Issue before opening a large rewrite.
- Never include API keys, tokens, private URLs, signed links, prompts, private assets, or unredacted logs.

### Pull requests

1. Branch from the latest `main` using `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, or `chore/<topic>`.
2. Link an Issue with `Closes #123`; use `N/A` only for tiny documentation corrections and explain why.
3. State the change, explicit non-goals, and risks. Do not bundle unrelated refactors.
4. Attach before-and-after screenshots or a short recording for UI changes.
5. Run relevant tests, normally `npm run test` and `npm run build`; list exact commands and explain omitted checks.
6. Check `todo.mdx` and `pending-test.mdx` whenever feature status changes.

Flovart has three official surfaces: **Workflow, Table, and Agent**. Do not restore the removed Canvas or Art surfaces. Any telemetry, external request, secret access, persistence change, or paid-provider path must disclose its data and security impact in the PR.

By contributing, you agree that your work is released under [AGPL-3.0-only](../LICENSE). Please also follow the [Code of Conduct](CODE_OF_CONDUCT.md).
