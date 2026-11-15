# Production Skill Commands

> Read this only when the task is to find, install, or create a Production Skill,
> or to turn a canvas (current or from history) into a reusable Skill.

A Production Skill is a package (`flovart.skill.yaml` + `SKILL.md`, optional
`evals/`, `references/`, `schemas/`). It never reads API keys or calls a
provider directly: everything it does goes through the Flovart Runtime and only
the capabilities its manifest declares.

The same commands exist on the CLI (`flovart skill.list --json`) and on MCP
(`flovart_skill_list`, `flovart_skill_draft`, `flovart_receipts_list`, …).

## Commands

| Command | Writes | What it does |
| --- | --- | --- |
| `skill.list` | no | Installed Skills (built-in, project, community roots). |
| `skill.manifest <id>` | no | One Skill's capabilities, permissions, gates, inputs. |
| `skill.hub.list --hub-url <url>` | no | Skills a Skill Hub publishes (https, or loopback http). |
| `skill.validate --from-dir <dir>` | no | Check a package directory before installing. |
| `skill.init <id>` | yes | Scaffold `community.<name>` without overwriting. |
| `skill.draft <id> --from-project <projectId>` | yes | Compile a canvas and its receipts into a draft package and run the basic evaluation. |
| `skill.install <id> --hub-url <url>` / `--from-dir <dir>` | yes | Install into the local registry. |
| `skill.uninstall <id>` | yes | Remove a community Skill. |
| `receipts.list --project-id <id>` | no | Shared, read-only receipts Agents left on a project. |

## Canvas → Skill

1. `workflow.project.list` to find the canvas. History canvases are listed too.
2. `workflow.inspect --project-id <id> --summary` to choose the nodes that make
   up the reusable flow. Skip one-off nodes.
3. `skill.draft community.<name> --from-project <id> --nodes a,b,c`.
   The draft lands in `.agents/skill-drafts/<name>` with its evaluation result.
4. Show the user the draft's steps and evaluation. Install only when they agree:
   rerun with `--install`, or `skill.install <id> --from-dir <dir>`.
   A draft that fails the evaluation is never installed.

Prompts in the draft are redacted for anything key-shaped, and the manifest
always declares `network: none` and `secrets: none`.
