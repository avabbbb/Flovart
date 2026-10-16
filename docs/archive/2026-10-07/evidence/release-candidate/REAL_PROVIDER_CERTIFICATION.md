# Real Provider Certification Matrix

Fake Provider HTTP tests prove Flovart's transport, canonical input, error,
idempotency, and recovery behavior. They do not certify a real provider's
model availability, billing, cancellation, or terms. Every real-provider row
therefore remains external until a credentialed, low-cost test is recorded.

## Required evidence per provider

For each provider and exact model, record:

- API version and endpoint;
- credential validation and unauthorized behavior;
- text-to-image and image-to-image request/response;
- text-to-video and image-to-video request/response where advertised;
- polling, timeout, retry, cancellation, and artifact behavior;
- rate-limit and provider-error mapping;
- observed billing/cost boundary and whether cancellation stops upstream work.

## Current matrix

| Provider path visible in the product | Exact model | T2I | I2I | T2V | I2V | Status |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI / OpenAI-compatible | Credential and model not used in this autonomous pass | Pending | Pending | Pending | Pending | External certification required |
| Google Gemini / Imagen | Credential and model not used in this autonomous pass | Pending | Pending | N/A | N/A | External certification required |
| Volcengine / Seedance | Credential and model not used in this autonomous pass | Pending | Pending | Pending | Pending | External certification required |
| RunningHub route catalog | Credential and route not used in this autonomous pass | Pending | Pending | Pending | Pending | External certification required |
| Custom provider / user script | User endpoint and model vary | Pending | Pending | Pending | Pending | Experimental; certify per endpoint |

## Evidence already available

- `tests/releaseCandidateProviderResilience.test.ts` and
  `RC_PROVIDER_RESILIENCE_EVIDENCE.md` cover the local Fake Provider over real
  HTTP transport.
- The fake fixture verifies T2I, I2I multipart, T2V, I2V reference payloads,
  polling, malformed responses, rate limits, timeouts, and duplicate-submit
  protection.
- No fake result is promoted to a real-provider or billing claim.

Until the rows above are completed with a real account and a deliberately
low-cost fixture, product launch remains `NO-GO`.
