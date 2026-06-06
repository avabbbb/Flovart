# Asset and Export Commands

## asset.list

List local generated media assets/history.

```bash
npm run flovart:cli -- asset.list --json
```

Use it to find generated media before adding results to a storyboard or final summary.

## export.project

Export project metadata.

```bash
npm run flovart:cli -- export.project --format json --json
```

Use this at delivery time when the user asks for a project summary or when an agent needs a compact state handoff.

## video.status

Query video/runtime job status.

```bash
npm run flovart:cli -- video.status --jobId <job-id> --json
```

Use for long-running video jobs. Do not submit duplicate video jobs until status confirms failure or cancellation.
