# Install and Setup

Flovart CLI is local to this repository.

## Local Project Setup

```bash
npm install
npm run flovart:cli -- ensure --json
```

启动器会同时准备 WebUI 和 Browser Agent，并用一次性 bootstrap 打开 Workflow。端口和凭据由 Link 内部管理；不要单独运行 `npm run dev` 后把普通地址当成已绑定的 Agent 页面。Provider-backed commands require the browser app to stay open because API keys remain in browser storage.

## Agent Host Init

Flovart exposes no MCP server to coding agents; the CLI is the only agent-facing interface. Use `init` to install the Flovart SKILL as a coding-agent attachment (`.agents/skills/flovart/SKILL.md`):

```bash
npm run flovart:cli -- init --target project-skill --json
```

`init` installs the complete package — `SKILL.md` plus `commands/`,
`model-schema/`, and `scripts/` — under the host's skill root. The canonical
package lives in `skills/flovart/`; `.agents/skills/flovart/` is the committed
snapshot init copies in a source checkout, and `tools/flovart/skill/flovart/`
is the packaged copy produced by `npm pack`. After editing `skills/flovart/`,
sync the snapshots before committing:

```bash
robocopy skills\\flovart .agents\\skills\\flovart /MIR   # Windows; POSIX: rsync -a --delete
cp skills/flovart/SKILL.md .claude/skills/flovart/SKILL.md
npm run docs:check   # fails if any snapshot drifted from skills/flovart
```

`npm run docs:check` compares the full `.agents/skills/flovart` tree against
`skills/flovart`, so a missing `commands/` or `scripts/` file breaks the check.

遇到安装契约不一致或需要诊断旧版本时，才读取当前 `init` schema：

```bash
npm run flovart:cli -- command.schema --command init --json
`init` installs the complete package — `SKILL.md` plus `commands/`,
`model-schema/`, and `scripts/` — under the host's skill root. The canonical
package lives in `skills/flovart/`; `.agents/skills/flovart/` is the committed
snapshot init copies in a source checkout, and `tools/flovart/skill/flovart/`
is the packaged copy produced by `npm pack`. After editing `skills/flovart/`,
sync the snapshots before committing:

```bash
robocopy skills\\flovart .agents\\skills\\flovart /MIR   # Windows; POSIX: rsync -a --delete
cp skills/flovart/SKILL.md .claude/skills/flovart/SKILL.md
npm run docs:check   # fails if any snapshot drifted from skills/flovart
```

`npm run docs:check` compares the full `.agents/skills/flovart` tree against
`skills/flovart`, so a missing `commands/` or `scripts/` file breaks the check.


## Doctor（兼容诊断）

`doctor` is a legacy-compatible diagnostic command. Prefer `status`, `host.list`,
and the visible Flovart Settings page for a normal setup; use doctor only when
investigating an older installation.

```bash
npm run flovart:cli -- doctor --json
```

Doctor must not expose secrets. If provider keys are missing, use the browser
Settings page. The following command remains a compatibility bridge:

```bash
npm run flovart:cli -- provider.begin-setup --purpose both --json
```

## Update Rule

If command documentation and CLI output conflict, use the registry only for bootstrap/compatibility/diagnostic discovery; normal Agent work follows `status` and the stable Workflow surface:

```bash
npm run flovart:cli -- command.list --json
npm run flovart:cli -- command.schema --command <command> --json
```
