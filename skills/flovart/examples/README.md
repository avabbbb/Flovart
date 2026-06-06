# Flovart Examples

These examples are task recipes for agents. Read the relevant file, then run the CLI with explicit prompts and IDs from the current canvas.

| Scenario | File |
| --- | --- |
| Product ad from references | `product-ad.md` |
| Short drama episode storyboard | `short-drama.md` |
| Multi-reference character consistency | `character-consistency.md` |
| Existing canvas diagnosis and repair | `diagnose-and-repair.md` |
| Reusable team production template | `team-template.md` |

Default pattern:

1. Inspect status, provider, canvas, and workflow.
2. Add references and create clearly named elements.
3. Attach prompts and reference slots.
4. Ask for confirmation before expensive generation when the user requested staged approval.
5. Generate only the required elements.
6. Inspect failed/pending jobs and propose the smallest repair.
7. Deliver IDs, URLs, failures, and next steps.
