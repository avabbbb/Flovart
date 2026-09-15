# native-effects (reserved)

This directory is reserved and intentionally empty of tasks.

Flovart's native effects are the AE / PR plugin path described in
`docs/design/flovart-native-effects.md`. No native effect exists in a runnable
state, so **no task is admitted here and no result is claimed**.

Rules for whoever adds the first task:

1. A native-effects task must drive a real host (After Effects or Premiere),
   through the real plugin surface. A panel that draws UI is not an effect.
2. The task must be able to assert host persistence: the effect survives host
   save, reopen, and export. A task that cannot observe the host document is not
   a native-effects task.
3. `eval/graders/nativeEffects/` holds the graders for this suite; keep them
   separate from the Workflow predicates so a missing host cannot silently fall
   back to grading a web surface.
4. Until then, `eval:core` and `eval:agent` must keep reporting this suite as
   empty rather than as passing.

Adding a placeholder task that "passes" without a host would be worse than an
empty directory: it would turn an unimplemented capability into a green number.
