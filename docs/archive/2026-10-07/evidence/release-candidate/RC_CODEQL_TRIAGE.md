# CodeQL Alert Triage

This is a read-only snapshot of the public GitHub CodeQL alerts for
`avabbbb/Flovart`, queried on 2026-09-02. All 13 alerts were still open and
their latest observed instances pointed at the remote `main` commit
`c60b452719fc3b0ddd32225556fbd86b73b5f299`; the detached RC candidate has not
been pushed and therefore has no Hosted CodeQL result.

The exact local application candidate under review is
`712031d88a427fb04316e590f74cffef67f435b9`. Local source fixes and focused
tests cover the observed alert sites, but GitHub alert state is not changed by
local evidence. The candidate must be pushed and scanned before any alert can
be treated as closed for release.

The snapshot contains 1 critical, 9 high and 3 medium alerts. A local source
diff can show that an old alert site changed, but it cannot close a GitHub
alert or certify the candidate. The final pushed SHA must run Hosted CodeQL
before release engineering can be marked green.

| Alert | Severity / rule | Old location | Candidate disposition |
| ---: | --- | --- | --- |
| 1 | High `js/polynomial-redos` | `tools/flovart/skill-hub.js:20` | The old trailing-slash regex was replaced by linear trimming. Hosted re-scan required. |
| 2 | High `js/polynomial-redos` | `tools/flovart/topic-research.js:204` | Fixed locally: artifact-key input is capped at 4096 characters and sanitized by an ASCII character scan; regression covers a 100,000-character hostile key. Hosted re-scan required. |
| 3 | Medium `js/stack-trace-exposure` | `agent/index.js:23` | Candidate redacts `stack`/`cause` and uses a generic internal error response. Hosted re-scan required. |
| 4 | Medium `js/stack-trace-exposure` | `dsh-plugin/src/workspaceProxy.ts:24` | Candidate redacts `stack`/`cause` in the proxy JSON boundary. Hosted re-scan required. |
| 5 | High `js/incomplete-url-substring-sanitization` | `services/aiGateway.ts:3057` | Candidate parses the URL and checks the exact hostname/path instead of an unrestricted substring. Hosted re-scan required. |
| 6 | Critical `js/request-forgery` | `dsh-plugin/src/workspaceProxy.ts:88` | The DSH proxy now accepts only an explicit-port `http://127.0.0.1` origin, rebuilds the outbound origin from the fixed loopback literal, allowlists routes/methods, and keeps the token host-side. Local tests cover localhost/IPv6, credentials, paths, invalid ports and query injection. This is still not declared closed until Hosted CodeQL scans the candidate and a security review agrees on the boundary. |
| 7–8 | High `js/xss-through-dom` | `components/table/TableWorkspace.tsx:151` | Candidate target renders media through React attributes rather than a dynamic HTML sink. Hosted re-scan required; no closure is claimed locally. |
| 9 | High `js/xss-through-dom` | `services/tableMediaProcessor.ts:94` | Candidate validates generated object URLs through `safeBlobUrl`; Hosted re-scan required. |
| 10–11 | High `js/incomplete-sanitization` | `skills/flovart/scripts/add-agent-role.js:64` | Candidate uses `JSON.stringify` for every generated string literal. Hosted re-scan required. |
| 12 | High `js/insecure-randomness` | `services/flovartActionRegistry.ts:119` | Candidate uses Web Crypto `randomUUID()` and fails closed when unavailable. Hosted re-scan required. |
| 13 | Medium `js/identity-replacement` | `services/aiGateway.ts:3470` | Candidate preserves the supplied aspect ratio directly; the old identity replacement is absent. Hosted re-scan required. |

## Release decision

Local secret audit and npm audit are green, but they do not replace Hosted
CodeQL. Until the candidate SHA has a clean or explicitly reviewed Hosted
result, the release security state is:

```text
LOCAL SECURITY CHECKS: PASS
HOSTED CODEQL: PENDING
REMOTE OPEN ALERTS: 13 on remote main, including 1 critical
RELEASE ENGINEERING: PARTIAL / EXTERNAL SECURITY GATE
PRODUCTION LAUNCH: NO-GO
```

## Final candidate binding

The final local source candidate is `712031d88a427fb04316e590f74cffef67f435b9`.
It has not been pushed, so no Hosted CodeQL result can be attached to it.
The 13-alert snapshot above remains a read-only observation of the older
public `main` SHA; local source fixes are evidence for the candidate but do
not close remote alerts. Hosted scanning and security review remain required.
