# Security Policy | 安全政策

[English](#english) · [中文](#中文)

## English

Flovart is a local-first product: projects, assets, generation history and provider API keys
live primarily on the user's own device. Because Closed Beta testing means strangers will
touch provider keys, local files, the loopback Runtime and Agent permission boundaries,
please report vulnerabilities privately instead of opening a public Issue.

### Supported versions

| Version | Supported |
| --- | --- |
| `0.3.x` (current beta line, on `main`) | Yes — security fixes land here |
| `0.2.x` and earlier public tags (e.g. `v0.2.0-test`) | No — upgrade to the latest `main` build |

The beta line is a release candidate, not a stable channel. Only the most recent
`main`-line build is evaluated for security fixes.

### How to report

Use **GitHub private vulnerability reporting** on the repository's Security tab:

- Go to [github.com/avabbbb/Flovart/security](https://github.com/avabbbb/Flovart/security)
  and choose **"Report a vulnerability"** (Private vulnerability reporting → draft
  security advisory). This keeps the report private between you and the maintainers.

Flovart does not currently provide a separate private security email — this matches the
contact policy in the [Terms of Service](docs/TERMS_OF_SERVICE.md) and
[Privacy Policy](docs/PRIVACY_POLICY.md). If private vulnerability reporting is not yet
enabled on the repository (see the maintainer checklist below), open a minimal public
Issue that says only "security issue — need private contact" and **do not** include
details, proof-of-concept, keys, or unredacted logs.

**Never** paste API keys, tokens, private URLs, signed links, prompts, private assets,
or unredacted logs into any report or Issue — this rule is already in the
[contributing conventions](.github/CONTRIBUTING.md).

### Scope

In scope — the trust boundaries documented in the
[threat model](docs/evidence/release-candidate/THREAT_MODEL.md):

- **Loopback Runtime / Agent bridge auth** — bypass of the loopback bearer token,
  Origin-binding, or workspace-lease checks on the `127.0.0.1` Agent/Runtime surfaces.
- **Provider key handling** — paths that leak API keys or `Authorization` headers into
  Agent/CLI results, diagnostics, logs, the recorder, or another storage boundary.
- **Agent workspace-binding** — mutating a project the Agent is not bound to, silent
  fallback from Browser to Native/Headless workspace, or cross-tab/cross-project writes.
- **Skill / plugin / toolkit package installs** — path traversal, archive escapes, or
  installs that exceed the declared package limits.
- **Local artifact and project storage** — reads or writes outside the declared storage
  boundary from the WebUI, extension, or DSH proxy paths.
- **Desktop (Tauri) IPC and updater boundary** — unsigned or mismatched update artifacts,
  IPC payloads that skip typed validation.

Out of scope:

- Third-party provider account behavior, billing, pricing, cancellation, or ToS — those
  belong to the provider, per the [support matrix](SUPPORT_MATRIX.md).
- The documentation site and demo page (`avabbbb.github.io/Flovart`) content issues
  that cannot affect a local install.
- Issues that require a real third-party host login (real Codex/DSH/WorkBuddy
  account, real UXP host) — those remain External Gates until certified; report them if
  you can demonstrate the flaw in repository-controlled code.
- Denial of service that requires physical access to the user's own device or already
  privileged local execution.
- The Workflow Node Plugin SDK being an in-process trusted-code surface — this is a
  documented boundary, not a sandbox claim; reports that treat it as a broken sandbox
  without a concrete escape are not actionable.

### What to include

- Affected version/commit and build channel (source, Web demo, desktop artifact).
- Minimal reproduction steps against the loopback surfaces or storage boundary.
- Expected vs actual behavior, and which trust boundary was crossed.
- Redacted logs only — strip keys, tokens, file paths outside the project, and prompts.

### Response expectations

- **Acknowledgement:** within 7 days of a private report.
- **Triage:** within 30 days the maintainers will confirm scope, severity, and whether
  the issue is fixable autonomously or is an External Gate (needs a real third-party
  account or hosted setting).
- **Fix & disclosure:** fixes land on `main`; the reporter is credited in the advisory
  unless they ask not to be. Please give the maintainers at least 90 days before public
  disclosure.

### Provider API keys are user-supplied and local-only

Flovart does **not** bundle model services and does not hold your provider keys. Keys are
entered by the user, stored locally (the Web path uses an encrypted `localforage` vault),
and sent only to the provider endpoint the user configured. Agent and CLI paths receive
redacted readiness/capability state, not raw credentials. A leaked key is almost always a
device-side or provider-side incident — rotate it at the provider first, then report the
Flovart path that exposed it if one exists.

### Security controls already in the repository

- `.github/workflows/security.yml` runs the tracked-secret audit, CodeQL for
  JavaScript/TypeScript and Rust, and high-severity dependency review on pull requests.
- `npm run release:secret-audit` scans every Git-visible text file for private-key,
  access-token, literal-bearer and hard-coded API-key patterns; matched values are never
  printed.
- CI runs the same secret audit plus typecheck, tests, builds and Rust tests.

These are source-controlled controls. They do **not** prove the corresponding GitHub-side
settings are enabled — see the maintainer checklist below.

<!-- ---------------------------------------------------------------------------
MAINTAINER CHECKLIST — GitHub-side settings this file cannot verify
-----------------------------------------------------------------------------
A SECURITY.md and a workflow file do not enable hosting controls. Before or during
Public Beta the repository owner should confirm each item in the GitHub UI/API and
update this file (and docs/evidence/release-candidate/GITHUB_REPOSITORY_SECURITY_CHECKLIST.md)
with the observed state:

- [ ] Enable **Private vulnerability reporting** (Settings → Security → Code security
      → Private vulnerability reporting). Without it, the "Report a vulnerability"
      button referenced above does not exist and reporters have no private channel
      (the repo currently provides no security email — see Terms of Service §15).
- [ ] Enable **Secret scanning** and **Push protection** (same page). The local
      `release:secret-audit` workflow does not turn these on; the 2026-09-02 API audit
      recorded them as disabled.
- [ ] Enable **Dependabot alerts** and decide on **Dependabot security updates**
      (no `.github/dependabot.yml` exists in-tree; hosted alerts were reported disabled).
- [ ] Confirm **Code scanning** coverage: the repo runs an advanced CodeQL workflow
      (`.github/workflows/security.yml`); either keep it or configure the default setup —
      do not run both.
- [ ] Protect `main`: required status checks (CI + Security), review requirement, no
      direct-push release bypass; the API audit recorded the branch as unprotected.
- [ ] Review Actions permissions (`allowed_actions: all` at audit time) and decide
      whether third-party actions must be SHA-pinned.
- [ ] Rerun hosted Security/CI on the exact candidate SHA before release publication.
- [ ] Keep the bilingual note in step: this file is English-primary with a 中文 section,
      matching `.github/CONTRIBUTING.md`; README.md/README.zh-CN.md link here.

Evidence snapshot to reconcile against:
`docs/evidence/release-candidate/GITHUB_REPOSITORY_SECURITY_CHECKLIST.md`
(read-only API audit, 2026-09-02).
---------------------------------------------------------------------------- -->

## 中文

Flovart 是本地优先产品：项目、素材、生成历史和 Provider API Key 主要保存在用户自己的设备上。
Closed Beta 意味着外部测试者会接触 Provider Key、本地文件、loopback Runtime 与 Agent 权限边界，
请通过私下渠道报告漏洞，不要直接开公开 Issue。

### 支持版本

| 版本 | 是否支持 |
| --- | --- |
| `0.3.x`（当前 beta 线，`main` 分支） | 支持 —— 安全修复落在这里 |
| `0.2.x` 及更早的公开 tag（如 `v0.2.0-test`） | 不支持 —— 请升级到最新 `main` 构建 |

beta 线是发布候选，不是稳定通道；只有最新的 `main` 构建会接受安全修复评估。

### 报告方式

使用仓库 Security 标签页的 **GitHub 私密漏洞报告**：

- 打开 [github.com/avabbbb/Flovart/security](https://github.com/avabbbb/Flovart/security)，
  选择 **"Report a vulnerability"**（Private vulnerability reporting → 草稿安全公告），
  报告只在你与维护者之间可见。

Flovart 目前不提供独立的安全邮箱，与[服务条款](docs/TERMS_OF_SERVICE.zh-CN.md)和
[隐私政策](docs/PRIVACY_POLICY.zh-CN.md)中的联系方式一致。如果仓库尚未开启私密漏洞报告
（见上方维护者清单），只开一个最小化公开 Issue 写明「安全问题——需要私下联系」，
**不要**附细节、PoC、Key 或未脱敏日志。

任何报告或 Issue 中**都不要**粘贴 API Key、Token、私有 URL、签名链接、Prompt、私人素材
或未脱敏日志——[贡献约定](.github/CONTRIBUTING.md)已有同样要求。

### 范围

在范围内 —— 对应[威胁模型](docs/evidence/release-candidate/THREAT_MODEL.md)中的信任边界：

- **Loopback Runtime / Agent Bridge 鉴权**——绕过 `127.0.0.1` Agent/Runtime 的
  bearer token、Origin 绑定或 Workspace Lease 校验。
- **Provider Key 处理**——把 API Key 或 `Authorization` 头泄漏进 Agent/CLI 结果、
  诊断、日志、录制器或其他存储边界的路径。
- **Agent 工作区绑定**——对未绑定项目的写操作、Browser → Native/Headless 的静默回退、
  跨标签页/跨项目写入。
- **Skill / 插件 / Toolkit 包安装**——路径穿越、压缩包逃逸、超出声明限制的安装。
- **本地 artifact 与项目存储**——WebUI、扩展或 DSH proxy 路径越出声明的存储边界读写。
- **桌面端（Tauri）IPC 与更新边界**——未签名或不匹配的更新产物、跳过类型校验的 IPC 负载。

不在范围内：

- 第三方 Provider 的账号、计费、定价、取消或条款行为——按[支持矩阵](SUPPORT_MATRIX.md)归属 Provider。
- 文档站与 Demo 页（`avabbbb.github.io/Flovart`）中不影响本地安装的内容问题。
- 必须依赖真实第三方宿主登录（真实 Codex/DSH/WorkBuddy 账号、真实 UXP 宿主）才能触发的问题——
  在认证前仍属 External Gate；若能在仓库自有代码中演示缺陷则仍可报告。
- 需要物理接触用户设备或本机已有特权执行才能造成的拒绝服务。
- 把 Workflow Node Plugin SDK 当作已失效沙箱的报告——该 SDK 是文档明示的进程内可信代码面，
  不是安全沙箱；没有具体逃逸证据的报告不可执行。

### 报告内容

- 受影响版本/提交与构建渠道（源码、Web demo、桌面产物）。
- 针对 loopback 面或存储边界的最小复现步骤。
- 预期行为、实际行为，以及被跨越的信任边界。
- 仅附脱敏日志——去掉 Key、Token、项目外路径与 Prompt。

### 响应预期

- **确认收到**：私下报告后 7 天内。
- **分诊**：30 天内确认范围、严重级别，以及该问题可自主修复还是属于 External Gate
  （需要真实第三方账号或托管侧设置）。
- **修复与披露**：修复落在 `main`；除非报告者要求匿名，会在公告中署名。
  公开披露前请给维护者至少 90 天。

### Provider API Key 由用户自备、仅保存在本地

Flovart **不**捆绑模型服务，也不持有你的 Provider Key。Key 由用户输入、保存在本地
（Web 路径使用加密的 `localforage` Vault），只发往用户自己配置的 Provider 端点。
Agent 与 CLI 只能拿到脱敏后的就绪/能力状态，拿不到原始凭据。Key 泄漏几乎都是设备侧或
Provider 侧事件——先去 Provider 处轮换 Key，再报告可能暴露它的 Flovart 路径（如果存在）。
