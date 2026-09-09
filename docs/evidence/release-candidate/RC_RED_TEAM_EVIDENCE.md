# Release Candidate Red-Team Evidence

The independent review pass was run after the RC implementation pass with
fresh source searches and `npm run release:red-team`.

## Automated checks

The release red-team script verifies:

- Workflow Core has no `NativeWorkflowStore` reference and no literal
  Host-specific branch for known external identities;
- model-facing Agent surface remains exactly five commands;
- signing key files are not tracked and remain ignored;
- all three source Skill projections are byte-identical, and the generated
  package projection is checked when `npm pack` has prepared it;
- packaged Agent setup guidance uses the current Runtime/visible-Workflow
  bootstrap path rather than the retired file-state path;
- the packaged CLI returns canonical output for `--help`;
- the desktop release workflow contains a release gate, draft-first publication,
  installer staging, checksum content verification, SBOM and tag-only
  attestation permissions/actions, including artifact metadata permission;
- the retired manual release workflow cannot invoke the Tauri publishing action;
- the security workflow contains the secret audit, CodeQL and dependency review;
- support diagnostics source has no raw credential/header/token fields and
  reduces endpoints through the loopback-origin helper.

Observed result:

```json
{
  "ok": true,
  "failures": [],
  "observations": [
    "workflow-core-files=59",
    "agent-public-commands=5",
    "generated-skill=present-and-aligned",
    "skill-projections=3",
    "local-signing-files-present=0"
  ]
}
```

The final candidate had no local signing files present; the updater public key
in the checked-in Tauri configuration is not treated as production key
certification.

The same red-team check was run from a dependency-installed clean detached
checkout before `npm pack`. It passed with
`generated-skill=absent-until-npm-pack`, proving the ignored packaged Skill is
not a clean-checkout prerequisite.

## Findings and disposition

- A first version of the check treated a `clientId` comparison in
  `workflowWorkspaceAdapter.ts` as Host-specific logic. The matcher was
  narrowed to known Host identity literals; the source was not changed because
  it was a valid writer-identity comparison, not a Core Host branch.
- No P0/P1 findings remain in this review pass.
- In-process Workflow Node Plugins remain trusted code rather than a security
  sandbox; this is documented in `THREAT_MODEL.md` and `RC_PLUGIN_EVIDENCE.md`,
  so third-party plugin isolation is not advertised as Stable.
- Production updater key custody, Authenticode, real Provider billing and real
  Codex/DSH login remain explicit external gates rather than hidden passes.

```text
npm run release:red-team
npx tsc --noEmit
git diff --check
```

## Final candidate recheck

The same release red-team command passed from clean candidate
`d539a9979cb7230f95783e3144d21ea9b6ac7685` with zero failures. It reported 59
Workflow Core files, five public Agent commands, three Skill projections and
no local signing files. The candidate remains unpushed; this local result does
not replace Hosted CodeQL or repository security configuration.

The final candidate `71f8395e071e237d6fb83c03e340d55d795b3df0` also passed the
same red-team check with zero failures, including the stable-tag signing
preflight assertion.

## Current exact candidate recheck

The current clean candidate is
`712031d88a427fb04316e590f74cffef67f435b9`. The same red-team check passed
with zero failures. It additionally requires the desktop workflow to stage
and verify signed updater metadata with
`scripts/check-updater-artifacts.mjs`; the stable-tag fail-closed signing
preflight remains intact. The candidate reports 59 Workflow Core files, five
model-facing Agent commands, three Skill projections and no local signing
files.

The local feed verifier separately passed its valid test-signed fixture and
four focused tests. This does not close Hosted CodeQL, production signing,
repository settings, real Provider or real Codex gates.

## Current clean candidate recheck

The current worktree snapshot `7bf531cf3e1fe02ccf68f38e38c5b97dc04f0306`
passed the red-team check with zero failures after a clean dependency install:
59 Workflow Core files, five model-facing Agent commands, three Skill
projections and no local signing files. The current candidate still requires
Hosted CodeQL/security settings, production signing, real Provider and real
Codex certification.
