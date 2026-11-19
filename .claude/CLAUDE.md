@AGENTS.md

## Claude Code

Use [docs/index.md](../docs/index.md) as the document map and the canonical Iris Skill under `.claude/skills/iris` for operation details. Do not infer current architecture from archived reports, old ADRs, one-off plans, or historical evidence.

When operating Iris from outside the app, prefer:

- `ensure` for preparation;
- `status`;
- `workflow.inspect`;
- `workflow.selection.get`;
- `workflow.apply`;
- `workflow.node.run`.

The visible Browser Workflow remains the current authority for these stable operations. The top-level surfaces are Canvas | Cut | Agent. The Agent page is connection/control only; the built-in Assistant drawer stays beside Canvas. Iris is the product name (renamed from Flovart on 2026-11-20); the second surface is Cut (formerly Reverse, briefly named Iris).

Do not bypass Iris by writing React/Zustand state, browser storage, Runtime databases or Provider private APIs directly. Use the same idempotency/revision rules documented by the canonical Skill.
