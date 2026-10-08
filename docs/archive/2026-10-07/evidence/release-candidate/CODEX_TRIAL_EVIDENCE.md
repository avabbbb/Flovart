# Codex `exec` Trial Evidence — 5 consecutive real runs

Source: five real `codex exec` (v0.154.0) sessions driving Flovart's Browser
Workflow through the CLI + `.agents/skills/flovart/SKILL.md` surface. Raw
`codex exec --json` transcripts were captured to `.tmp/codex-trial-{3..7}.jsonl`
during the run; that directory is not committed, so this file records the
sanitized, auditable summary the Support Matrix claim rests on.

## What each trial did

Codex read the Flovart skill, then drove the **real Browser Workflow** (no
mock) through the stable 5-op Agent surface to build a 3-node, 2-connection
workflow (`workflow.node.create-connected`).

| Trial | turn.completed | workflow.inspect | workflow.selection.get | workflow.apply | workflow.node.run | create-connected |
|-------|---------------|------------------|------------------------|----------------|-------------------|------------------|
| 3 | 1 | 23 | ✓ | 14 | 7 | 26 |
| 4 | 1 | 29 | ✓ | 18 | 6 | 30 |
| 5 | 1 | 23 | ✓ | 8  | 6 | 33 |
| 6 | 1 | 29 | ✓ | 9  | 6 | 26 |
| 7 | 1 | 23 | ✓ | 12 | 6 | 22 |

All five reached `turn.completed` — Codex finished the task each run, not a
crash or timeout. The recurring `"type":"error"` items are Codex's own
`default_mode_request_user_input` under-development warning (benign, present on
every `codex exec` invocation of this version), not a Flovart failure.

## Interpretation boundary

- This evidence covers **Codex driving the Workflow surface** — the agent can
  discover the skill, connect, inspect, apply, and run against a real browser
  workflow. That is what the `Beta` row claims.
- It does **not** cover a real paid Provider wire, nor a logged-in Codex
  session from a clean *installed* app — those remain External Gates in the
  Support Matrix.
- Raw `.tmp/codex-trial-*.jsonl` are local-only artifacts; the durable,
  reviewable record is this file. If a future audit needs the raw transcripts,
  re-run the harness in `docs/evidence/release-candidate/CODEX_CERTIFICATION.md`
  on a logged-in machine.
