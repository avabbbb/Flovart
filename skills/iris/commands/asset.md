# Asset and Export Commands

> Compatibility surface: these granular commands remain for existing scripts and diagnostics. New Agent work uses the stable five-command surface.

## asset.list

List local generated media assets/history.

```bash
npm run iris:cli -- asset.list --json
```

Use it to find generated media before adding results to a storyboard or final summary.

## export.project

Compatibility name for `workflow.inspect`: the CLI forwards it, so the result is the redacted Workflow graph.

```bash
npm run iris:cli -- export.project --project-id <id> --json
```

Use this at delivery time when the user asks for a project summary or when an agent needs a compact state handoff.

## video.status

Compatibility name for `task.get`: the CLI forwards `--job-id` as the Runtime `taskId` returned by `generate.video`.

```bash
npm run iris:cli -- video.status --job-id <task-id> --json
```

Use for long-running video jobs. Do not submit duplicate video jobs until status confirms failure or cancellation.
