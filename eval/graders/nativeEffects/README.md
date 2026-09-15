# nativeEffects graders (reserved)

Reserved for host-level graders: After Effects / Premiere project inspection,
effect-parameter persistence across save/reopen/export, and keyframe survival.

These cannot be expressed as `eval/graders/predicates.mjs` predicates, because
those read a WorldSnapshot of the Workflow graph. A native effect is graded by
reading the **host** document after the host has round-tripped it.

Keep the split:

- `eval/graders/predicates.mjs` — Workflow / Runtime / Provider / local-asset
  state, read from `captureWorldSnapshot()`.
- `eval/graders/nativeEffects/` — host document state, read from the host.

Do not add a native-effects grader that passes when no host is attached.
