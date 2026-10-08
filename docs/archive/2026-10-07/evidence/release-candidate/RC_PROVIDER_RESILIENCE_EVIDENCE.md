# Release Candidate Provider Resilience Evidence

## Local HTTP soak

`tests/releaseCandidateProviderResilience.test.ts` starts the real local Fake
Provider over an ephemeral `127.0.0.1` HTTP port and exercises the production
generation transport:

- T2I: 30;
- I2I: 30, with a real reference download and edit route;
- T2V: 20, with async create/poll/content retrieval;
- I2V: 20, with a real first-frame reference.

Observed invariant: 100 successful logical generations, 100 provider submit
requests, 0 duplicate submissions, 30 edit requests with one reference, and
20 video requests with one reference. The key and recorder remain redacted by
the existing Fake Provider boundary.

The same suite changes the local Provider from rate-limited to healthy and
verifies that the failed attempt is visible and the explicit retry succeeds;
the retry produced exactly two submissions for two logical attempts.

## Existing failure/recovery coverage

`tests/fakeProviderIntegration.test.ts` additionally covers unauthorized,
rate-limit, provider error, malformed response, bounded model discovery
timeout, bounded video polling timeout, and resuming an already-submitted
video task without a second create request. The resume test is the current
wire-level proof for refresh/restart-style continuation when a provider task id
has already been persisted.

## Verification

```text
npx vitest run tests/releaseCandidateProviderResilience.test.ts tests/fakeProviderIntegration.test.ts tests/fakeProviderServer.test.js --reporter=dot
```

No real Provider key or paid endpoint is used. Provider pricing, billing,
cancellation semantics, account limits, and visual quality remain external
certification gates.
