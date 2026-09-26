# Historical evaluation fixtures

This directory keeps **small, reviewable records** from older real-world evaluation runs.

Keep in Git:

- evaluation reports and research notes;
- production specs and task receipts;
- verification JSON;
- captions / text fixtures;
- scripts needed to understand or reproduce the run.

Do **not** commit generated binary media here:

- MP4 / MOV;
- WAV / other generated audio;
- generated PNG / JPG contact sheets, previews or frames.

Those outputs are evidence artifacts rather than source. Publish future generated media through CI artifacts, GitHub Releases or project-controlled object storage, and link the artifact location from the evaluation report when long-term access matters.

Historical generated media removed during the Iris repository-hygiene pass remains recoverable from Git history before that cleanup unless repository history is intentionally rewritten later.

The reports in this directory may still use the former **Flovart** product name. That wording is historical context, not current branding.
