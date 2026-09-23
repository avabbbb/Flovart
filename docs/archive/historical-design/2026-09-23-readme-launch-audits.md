# Historical README / launch audits — 2026-09-23

Status: **HISTORICAL SNAPSHOT**

This file replaces several one-off README maintenance documents that had completed their purpose and had started to contradict one another. The detailed originals remain available in Git history.

## What those audits accomplished

The September launch/README passes established several durable rules:

- lead the repository with the product outcome before architecture/roadmap detail;
- do not claim a named Agent, Provider or creative host beyond the evidence actually captured;
- keep `SUPPORT_MATRIX.md` as the compatibility/certification source of truth;
- keep real demo provenance in `docs/maintenance/readme/DEMO_RECORDING.md`;
- use tracked repository assets for README media;
- distinguish local fixture/build evidence from real Provider/host evidence;
- keep GitHub About/Topics aligned with verified product positioning.

They also produced the current README demo assets and fixed several launch-time defects. Those results remain in the repository; the old execution checklists do not need to remain active instructions.

## Why the source documents were removed from active maintenance

The old files mixed dated tasks, already-completed instructions, machine-specific paths and stale status statements. Some later sections contradicted earlier sections (for example, the recorded Hero host/provenance and whether an ignored artifact was still the canonical README asset).

Keeping them under `docs/maintenance/` made it too easy for an Agent to mistake historical execution notes for current truth.

Removed from the active tree:

- `README_ASSET_AUDIT.md`
- `README_CLAIM_AUDIT.md`
- `README_GITHUB_METADATA.md`
- `README_LAUNCH_PACK.md`
- `README_VISUAL_TODO.md`

## What remains current

Use these instead:

- product/system direction: `docs/design/flovart-native-effects.md`
- Agent boundary: `docs/design/agent-integration.md`
- current capability/certification: `SUPPORT_MATRIX.md`
- unfinished work: `docs/content/docs/progress/todo.mdx`
- implemented-but-unverified work: `docs/content/docs/progress/pending-test.mdx`
- demo provenance: `docs/maintenance/readme/DEMO_RECORDING.md`
- repository homepage copy: current `README.md` / `README.zh-CN.md`

If a historical number, command, local path or recording statement conflicts with these current sources, the current source wins.
