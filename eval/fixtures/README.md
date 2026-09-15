# fixtures

Fixtures are **inline** in each task (`task.fixture`), because the initial world
is part of the task's meaning: a reader must be able to see the starting graph
and the expected end state in one file.

This directory is for shared, reusable fixture *files* (media, ACL descriptors,
provider recordings) that more than one task needs. It is empty today; nothing
here should ever be the only copy of a task's initial state.

Rules if a file is added here:

- It must be referenced by a path relative to this directory, never an absolute
  developer path — `eval/run.mjs validate` rejects absolute paths in tasks.
- It must contain no secret. The validator runs the same secret patterns over
  task definitions; apply the same standard here.
- Ids declared inside a fixture are preserved by the normaliser, so they stay
  addressable from predicates. Randomly generated ids are replaced with
  positional placeholders.
