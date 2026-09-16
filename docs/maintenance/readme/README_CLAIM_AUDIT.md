# README claim audit

This audit is the evidence boundary for the current README pair. “Implemented locally” means the repository contains a reproducible path or contract; it does not mean a third-party Host, paid Provider, public release or production deployment has been certified.

| Claim in the README | Evidence | Status |
| --- | --- | --- |
| Flovart is an agent-native visual production workspace | [Workflow surface](../../../components/workflow/WorkflowWorkspace.tsx), [Agent surface mount](../../../App.tsx#L496-L547), and [current feature boundaries](../../content/docs/overview/features.en.mdx#L5-L15) | Positioning grounded in current product surfaces; maturity is intentionally qualified |
| Human and agent can operate the same visible Workflow | [Workflow Agent Bridge snapshot/activation](../../../services/workflowAgentBridge.ts#L187-L193), [typed Workflow dispatch](../../../services/workflowAgentBridge.ts#L231-L285), [Browser authority evidence](../../evidence/release-candidate/RELEASE_TRUTH_MATRIX.md#L50-L55) | Implemented locally; Host login and public certification remain external gates |
| The normal Agent surface is inspect/apply/run, not UI clicking | [Canonical CLI help](../../../tools/flovart/core.js#L80-L108), [Workspace command surface](../../../tools/flovart/workspace-command-surface.js#L1-L29), [Flovart Skill](../../../skills/flovart/SKILL.md#L34-L70) | Stable local contract; host projections remain Experimental or Planned |
| The Workflow remains human-editable | [Workflow entry and controls](../../../App.tsx#L496-L525), [Workflow feature list](../../content/docs/overview/features.en.mdx#L17-L24), [real screenshot](../../../pic/WorkFlow.png) | Foundation available locally |
| Image and video production are first-class Workflow capabilities | [Workflow generation input types](../../../components/workflow/inputResolver.ts#L17-L28), [generation service](../../../services/workflowGeneration.ts#L1-L18), [feature boundary](../../content/docs/overview/features.en.mdx#L17-L24) | Foundation available; provider quality, billing and cancellation are not Stable claims |
| BYOK and multi-provider paths exist | [Provider adapters and models](../../../services/aiGateway.ts#L186-L252), [provider settings](../../../components/SettingsPanel.tsx#L384-L520), [key lifecycle](../../../hooks/useApiKeys.ts#L195-L209), [matrix](../../../SUPPORT_MATRIX.md#L27-L36) | Implemented locally; OpenAI-compatible and remote-provider paths are Experimental |
| References converge into generation inputs | [Canonical reference origins and mentions](../../../components/workflow/inputResolver.ts#L17-L55), [reference materialization](../../../services/workflowGeneration.ts#L74-L95) | Implemented locally for the current Workflow path |
| Production Skills are reusable production methods | [Skill package surface](../../../skills/flovart/SKILL.md#L34-L70), [WorkBuddy Skill package](../../../services/agentSkillPackage.ts#L1-L15), [VOX reference](https://github.com/avabbbb/vox-director) | Local Skill surface and reference exist; wider ecosystem is in design/implementation |
| Projects and assets are local-first | [Asset storage](../../../utils/assetStorage.ts#L1-L35), [key vault](../../../utils/keyVault.ts#L1-L10), [feature boundaries](../../content/docs/overview/features.en.mdx#L58-L62) | Current browser-local path; no cloud-sync claim |
| API keys stay inside the local browser/runtime boundary | [Encrypted key persistence](../../../utils/keyVault.ts#L76-L111), [key sync boundary](../../../hooks/useApiKeys.ts#L195-L209), [agent redaction and confirmation](../../../services/workflowAgentBridge.ts#L237-L285) | Local implementation evidence; not a third-party security certification |
| Host statuses in the README are accurate | [Support Matrix agent hosts](../../../SUPPORT_MATRIX.md#L6-L16) and [creative hosts](../../../SUPPORT_MATRIX.md#L18-L25) | Single source of truth; Experimental/Planned values are preserved |
| Flovart Link and Workspace Lease exist | [Support Matrix runtime paths](../../../SUPPORT_MATRIX.md#L27-L36), [current architecture record](../../design/ecosystem/CURRENT_ARCHITECTURE.md) | Local implementation is present; full chaos and third-party certification remain |
| WorkBuddy is an Experimental Connector + Skill artifact | [WorkBuddy build validator](../../../integrations/workbuddy/build.mjs#L10-L31), [matrix boundary](../../../SUPPORT_MATRIX.md#L13-L16) | Artifact is locally buildable; real client/Marketplace/NL tracer is not certified |
| DeepSeek Harness is an Experimental RC8 profile/bundle | [DSH package README](../../../dsh-plugin/README.md#L1-L13), [matrix boundary](../../../SUPPORT_MATRIX.md#L13-L14) | Packed profile and contract evidence; real login/recovery remains external |
| Photoshop, Premiere, After Effects and Resolve are not Stable | [Studio package boundary](../../../integrations/studio/README.md#L19-L43), [matrix](../../../SUPPORT_MATRIX.md#L18-L25) | All remain Experimental; no Stable host claim is made |
| Preview downloads are not a Stable release promise | [Release truth](../../evidence/release-candidate/RELEASE_TRUTH_MATRIX.md#L26-L39), [public documentation state](../../evidence/release-candidate/RELEASE_TRUTH_MATRIX.md#L61-L67) | README uses “preview” and keeps publication as an external gate |
| Source Quick Start is available | [root CLI script](../../../package.json), [CLI implementation](../../../tools/flovart/cli.js#L1-L28), [source guide](../../overview/quick-start.en.md#L1-L18) | Repository-verified source path；已实测 `status --json` 返回结构化结果 |
| External agent operations update the same visible Workflow | [recording record](DEMO_RECORDING.md), [final state still](../../../pic/readme/agent-operations-final-state.png), [bootstrap handshake](../../../services/agentConnectionBootstrap.ts) | 已录制真实运行（project/node/connect → 画布实时更新）；具名宿主对话 tracer 仍未认证 |
| `flovart setup` no longer teaches an unpublished package | [setup text](../../../tools/flovart/core.js#L80-L91), [bundle manager](../../../tools/flovart/bundle-manager.js#L212-L214) | 已修复：原文本教 `npx flovart-cli ...`，实测该包名在 npm registry 返回 404 |
| `browser` connection bootstrap survives a slow host scan | [bootstrap probe budget](../../../services/agentConnectionBootstrap.ts#L197-L206) | 已修复：`/hosts` 实测 3–4s > 原 1200ms 预算，导致 writer 永远无法激活；现单独放宽到 8000ms |
| `npx flovart-cli` is a public install path | [local package metadata](../../../tools/flovart/package.json) and the configured npm registry check | Not claimed in README: registry lookup returned 404, so source checkout remains the documented path |
| Docker is production-ready | [Compose guide boundary](../../overview/quick-start.en.md#L68-L78), [project rule](../../../AGENTS.md#L104-L107) | Not claimed; local integration only |

## Deliberately removed or downgraded

- The first screen no longer leads with External Harness, Workspace Operator or Production Crew.
- The native-effects roadmap paragraph no longer occupies the first screen; it moved to `## Creative App Roadmap`.
- Quick Start moved from ~71% of the document to the first half.
- Repeated `Experimental` / `not certified` caveats were consolidated into `Integrations and compatibility` plus one line under the table.
- No Host, Provider, Adobe integration, WorkBuddy path or future roadmap item is described as Stable.
- No benchmark, fake Stars/Downloads number, cloud-sync promise or unsupported `npx` installation flow is included.
- The dynamic Hero recording is labelled as **external agent CLI operations**, not as a named coding-agent conversation. Claiming the latter would overstate what was actually captured.
- Debug-only details such as fixed ports, dynamic browser ports, Playwright, command schemas and private transport are linked from development docs instead of occupying the product story.

## Round 2 — defects fixed while producing the recording

1. `tools/flovart/core.js` `SETUP_TEXT`, `tools/flovart/bundle-manager.js` and `tools/flovart/dev-commands.js` told users to run `npx flovart-cli ...`. `npm view flovart-cli` returns **404**, so `flovart setup` was teaching a dead path. All three now print the source-checkout equivalent (`npm run flovart:cli -- <command>`).
2. `services/agentConnectionBootstrap.ts`: the bootstrap aborted `/hosts` at the default 1200ms budget, but that endpoint took 3–4s on this machine because it re-scans installed hosts on every call. The browser therefore never became the workspace writer, and `npm run test:browser:chrome` failed. The hosts probe now gets an 8000ms budget while `/health` keeps 1200ms so a genuinely absent Agent still fails fast.
   **Still open (deeper fix):** `/hosts` has no server-side cache; it should be cached with a short TTL instead of relying on a wider client timeout.
3. `scripts/chrome-browser-smoke.mjs` navigates 15s after WebUI readiness, but a cold Vite compile takes ~26–48s before the app mounts. The gate is therefore flaky on a cold checkout. Warming the dev server before the timed navigation (or raising that one timeout) is still open.
