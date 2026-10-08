# Release-candidate evidence

This directory contains the release-candidate, security and provider evidence
that used to sit in the repository root. The documents are useful for
maintainers and reviewers, but they are not the product's primary onboarding
path.

- `RELEASE_TRUTH_MATRIX.md` is the claim and gate summary.
- `RC_FINAL_CERTIFICATION.md` is the local certification snapshot.
- `THREAT_MODEL.md` and `GITHUB_REPOSITORY_SECURITY_CHECKLIST.md` cover the
  security boundary and repository-level gates.
- The `RC_*_EVIDENCE.md` files contain focused verification records.

Local evidence does not replace real Host login, paid Provider, signing,
hosted CI or public release certification where those gates are explicitly
marked as external.
