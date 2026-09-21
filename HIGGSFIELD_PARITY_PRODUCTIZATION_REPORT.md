# Higgsfield × Flovart — Productization Parity Report

**Sprint:** Flovart×Higgsfield Productization Adversarial Sprint (Lanes 15–18 + Judges 19–20)
**Judge:** Agent20 — integration jury + report owner · **Independent re-judge:** Agent19
**Date:** 2026-09-21
**Baseline:** `eval/product-maturity/higgsfield-parity.json` (12 journeys, `before=UNASSESSED`) → `higgsfield-parity.after.json`
**Evidence dirs:** `.tmp/sprint/{benchmark,prosecution,defense,verdicts,implementation}/`

---

## 1. What Higgsfield actually does today

Researched live (`.tmp/sprint/benchmark/`), not from memory. The transferable product pattern:

- **Coding-Agent path is split CLI + Skills.** Higgsfield positions `higgsfield` CLI + a Skill layer explicitly for Codex / Claude Code / Cursor; MCP is reserved for chat agents with free-form tools. CLI and Skills share one account auth — the agent never hits the raw API.
- **Skill install is a productized one-liner.** `npx skills add higgsfield-ai/skills`; a setup script auto-detects Claude Code / Cursor / Codex and installs to the right location — no manual directory copying.
- **Skill UX contract hides plumbing.** No raw IDs, no polling/job narration, few questions, sane defaults, local file paths auto-handled, failed jobs resumed rather than re-submitted, no duplicate running jobs.
- **Creative-host plugin loop is install→in-host→back-to-host.** AE/Premiere ship "download → panel appears in host → generate/edit against current context → result lands back in the host project." The host keeps editing; only generation goes to the platform.

## 2. Patterns worth adopting (and adopted)

| Higgsfield pattern | Adopted as |
|---|---|
| CLI + Skill for coding agents | Canonical `npm run flovart:cli -- <cmd> --json` + `skills/flovart` Skill (already the model-facing contract) |
| Auto-detect skill install | `flovart init --target codex|claude-code|opencode|project-skill` + `doctor` verify |
| Hide plumbing from user/agent | `services/displayError.ts` jargon→product mapper + `runtimeHealth.classifyAgentSetupError` |
| Resume-not-resubmit | Stale-loading zombie scan + auto-resume of persisted `providerTaskId` video nodes |
| Plugin returns to host context | `browserLink.ts` Live getters + `dispatchWorkflowCommand`; Premiere/AE contract scaffolded |
| One product, many entrances | Agent demoted to a single global drawer over Canvas+Table |

## 3. Patterns explicitly rejected

Adopting these would have rebuilt Higgsfield's **cloud-capability** center, which is the frozen anti-goal:

- `Flovart credits`, `billing`, `organization`, `marketplace`, central `account` — rejected (Higgsfield needs them to sell cloud capacity; Flovart is local-first/BYOK).
- **40+ CLI nouns** — rejected; model-facing surface frozen at `status / workflow.inspect / workflow.selection.get / workflow.apply / workflow.node.run` + `ensure`.
- **9 vertical production skills** — deferred; one `flovart` skill carries the contract.
- **Cloud model catalog / enterprise backend** — rejected; provider layer stays pluggable BYOK.

## 4. Flovart differentiation (kept)

```text
Higgsfield center = Cloud capability
Flovart center    = Workflow state
```

Live `WorkflowProject` draft remains the single state authority; Human Canvas, Coding Agent, and Creative Host are three verbs over it — not three backends. local-first, BYOK, open-source, human+agent shared state.

## 5. Before journey (baseline)

First-run friction was documented by prosecutors (`.tmp/sprint/prosecution/`): cold-open hit a raw credential error with no path forward; two competing Agent surfaces (top-nav mode that unmounted the canvas + a side drawer); layer clicks didn't reveal nodes; a persisted `loading` node after reload was a silent zombie; folder permission loss failed silently; ~34 P1 jargon/discoverability findings.

## 6. After journey

- **Cold open** → classified setup card (`Add API key →` / `Try offline mode →`) instead of a jargon dead end.
- **Canvas + Agent** → one docked global drawer; canvas never unmounts; layer click reveals the node; **F** frames the selection.
- **Recovery** → stale `loading` nodes surface "generation interrupted — rerun or stop"; folder aborts give product notices.
- **Errors** → every error→UI write routes through `displayError`; zero raw `error.message`/HTTP/ID leaks on the normal path.

## 7. Prosecutor findings (Group B/C)

72 findings baseline (P0=5, P1=34, P2=33), 47 open → 20-item gap freeze → **13 CONFIRMED_GAP**. Headline items: dual-Agent IA (#1), credential wall (#2), no browse-first (#9), i18n inert (#10), agents-offline silence (#15), jargon leaks (#7), dead abstraction layers (#11), drawer-overlay (#4), layer-no-reveal (#5), no frame-key (#6), stale-loading (#8), folder silent-fail (#12), config-root sprawl (#13).

## 8. Defender rebuttals (Group D)

Agent13 (product) + Agent14 (architecture) corrected over-reach before it cost us: **KEEP** `browserWorkflowContract` (real DI seam), `managedFlovartAgent` (different SSE direction), `supportDiagnostics` (redaction boundary — reconnected, not deleted). **CONCEDED** 7 dead layers for deletion. This is the adversarial filter working — not every "Higgsfield has it" survived.

## 9. Judge decisions (Group F)

- **Agent20 (integration):** parity 6 PASS / 6 PARTIAL / 0 FAIL; merge coherent; `tsc` 0 errors; 173/173 tests green.
- **Agent19 (independent, fresh eyes):** parity **9 PASS / 3 PARTIAL / 0 FAIL** — counted Local-media, Recovery, Job-waiting as PASS (workflow.node.run blocks to terminal status, which beats `--wait`).
- The two judges **agree on all three PARTIALs**: Coding-Agent install (one flow, not one-command), Host plugin (EXTERNAL_GATE), Install docs (no non-dev walkthrough).

## 10. Implemented changes

| Lane | Landed |
|---|---|
| 16 IA keystone | top-nav Agent mode killed; global docked drawer over Canvas+Table; legacy `activeView='agent'`→`'workflow'` |
| 15 first-run | credential-wall setup card; browse-first deck; ~68 i18n keys; agents-offline product message |
| 17 canvas | layer-click→reveal; F-frame key + toolbar action; stale-loading scan + working stop; folder-fail notices; sidebar dock |
| 18 hardening | `displayError.ts` wired into 13 services; 7 dead layers + scripts deleted; sidecar lease blind-window closed; supportDiagnostics reconnected |
| tail | 19 `displayError` wraps + ErrorBoundary + media/project-list surfaces |

## 11. Rejected implementations

- Advocate-B's `browserLink.ts` as a *host* link — rejected (process boundary), re-scoped to in-workspace preview.
- No Manager/Facade/Gateway/Runtime/Provider additions — the freeze held; we deleted 7 layers instead of adding any.
- No second Workflow authority, runtime, or provider-auth owner introduced.

## 12. UX maturity

| Journey | After | Evidence |
|---|---|---|
| Coding Agent install | PARTIAL | `flovart init --target …` + doctor — one flow, not one-command auto-detect |
| CLI | PASS | single `flovart` entry, `--json` contract, idempotency, node.run blocks to terminal |
| Skill | PASS | hides plumbing; SKILL.md teaches 5 ops + ensure |
| Auth/config | PASS | setup card + credential classification + offline path |
| Local media | PASS (A19) / PARTIAL (A20) | zero-copy `local-folder:` refs, materialize only on run |
| Job waiting | PASS | lifecycle hidden; stale-scan covers interrupted waits |
| Recovery | PASS | auto-resume persisted task + stale reset path |
| Agent | PASS | global docked drawer, canvas stays mounted |
| Host plugin | PARTIAL | contract scaffolded; Premiere is EXTERNAL_GATE |
| Product state | PASS | WorkflowProject draft sole authority |
| User jargon | PASS | `displayError` sole mapper, ~68 i18n keys |
| Install docs | PARTIAL | README quick-start exists; no numbered non-dev walkthrough |

**Parity tally — Agent19: 9 PASS / 3 PARTIAL / 0 FAIL. Agent20 (conservative): 6 / 6 / 0.**

## 13. Backend directness

`backend-paths.json` + `state-owners.json` (eval fixtures) re-checked post-sprint: **no state owner added, no pass-through layer added, no model-facing tool added, no runtime added, no provider-auth owner added** — and 7 dead layers were deleted. Directness moved the right direction. (Full count verification: `.tmp/sprint/implementation/VERIFICATION_TAIL.md`.)

## 14. Holdout results

`eval/product-maturity/holdout/` (H-01..H-08 are path-mounted, never committed — `eval/README.md`). Two committed scenarios run **live** this pass:

- **ho01-cold-onboarding** — PASS · `timeToFirstUsefulAction=13ms` · first-launch controls + create-CTA in-viewport.
- **ho02-state-survives-resize** — PASS · drawer stays open across 1440→1024 resize.

Gated on environment (not code defects): Premiere/AE real host, File-System-Access grant (headed Chrome), BYOK provider credentials.

## 15. External gates

- **Premiere / After-Effects host plugin** — UXP manifest (`manifestVersion 5`, Premiere Pro 25.6+) + contract exercised by mocks; real clip→frame→generate→import loop needs a live host + the Link-side `__FLOVART_PREMIERE_*__` injector. **EXTERNAL_GATE** — not claimed as real-host verified.
- **FSA grant** (UX-FTC-02) — headed-Chrome only.
- **Provider/agent hosts** (UX-FTC-03/04, UX-AGT-01) — BYOK offline in dev; largest *activation* blocker, not a code defect.

## 16. Closed-Beta verdict

All 12 journeys moved off `UNASSESSED`; none regressed to FAIL and none are code defects — the 3 PARTIALs are environmental (real Premiere host, FSA, BYOK) or scope (one-command installer, non-dev quickstart). Type-clean (0 errors), touched-area suite fully green (173/173), both committed holdouts PASS live, directness invariants held, product-copy gate clean (zero banned jargon on normal path).

**HIGGSFIELD_GRADE_BETA_READY_WITH_EXTERNAL_GATES**
