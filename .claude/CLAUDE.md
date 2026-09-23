@AGENTS.md

## Claude Code

Use [docs/index.md](../docs/index.md) as the document map and the canonical Flovart Skill under `.claude/skills/flovart` for operation details. Do not infer current architecture from archived reports, old ADRs, one-off plans, or historical evidence.

When operating Flovart from outside the app, prefer:

- `ensure` for preparation;
- `status`;
- `workflow.inspect`;
- `workflow.selection.get`;
- `workflow.apply`;
- `workflow.node.run`.

The visible Browser Workflow remains the current authority for these stable operations. The top-level Agent page is connection/control only; the built-in Assistant stays beside Canvas/Table.

Do not bypass Flovart by writing React/Zustand state, browser storage, Runtime databases or Provider private APIs directly. Use the same idempotency/revision rules documented by the canonical Skill.
