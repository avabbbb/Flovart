# Flovart Product Story & Agent Onboarding Reference

Status: **PROPOSAL / REFERENCE**  
Updated: 2026-09-23

This note does not replace the current Flovart architecture or support matrix. It captures product, onboarding and launch patterns worth borrowing from successful Agent-first creative tools while preserving Flovart's existing strengths: a visible shared Workflow, typed operations, local-first state and human control.

## 1. Product story: sell the outcome before the architecture

The first-screen story should answer **what a creator gets**, not first explain the internal stack.

Recommended narrative:

```text
Brief or reference
      ↓
Agent builds the visible Workflow
      ↓
Generate / transform media
      ↓
Human edits the same Workflow
      ↓
Re-run only what changed
      ↓
Reusable production recipe
```

Candidate product promise:

> Give your Agent a creative brief. It builds the same visual Workflow you can inspect, edit and run.

The architecture story remains important, but moves behind the outcome:

- Agent-native typed operations;
- one live Workflow shared by human and Agent;
- BYOK / multi-provider execution;
- local-first assets and state;
- revision, idempotency and approval boundaries.

## 2. The Hero demo should be a complete production loop

The current “Agent creates nodes and edges” demo proves the control plane but does not yet prove the creator outcome.

Target Hero storyboard (roughly 15–30 seconds once the underlying generation path is genuinely ready):

```text
1. User gives a short brief or reference
2. Agent creates a small shot / asset graph in the visible canvas
3. Agent selects or asks for the required model/provider
4. User reviews the production plan
5. Generation runs and real result nodes appear
6. User changes one prompt / reference / node
7. Only dependent work becomes stale and is re-run
8. Updated result appears without rebuilding everything
```

The demo should show one meaningful end-to-end task, not a montage of unrelated features.

Until model-backed recording is reproducible, keep the current honest recording and treat this as the target demo contract rather than a claim of current behavior.

## 3. Reusable Workflow is the durable artifact

Do not introduce a new Flovart-specific markup language just for marketing.

Flovart already has the more natural intermediate representation for its product: the Workflow graph plus assets, parameters, results and lineage.

Productize that idea:

> Every creation becomes a reusable Workflow.

A useful Workflow should preserve enough structure that a creator can:

- replace a product, character, reference or prompt;
- swap a model/provider;
- keep already accepted assets;
- create variants without rebuilding the project;
- understand which outputs depend on which inputs.

This turns Flovart from “an AI canvas” into a reusable production system.

## 4. Plan → Approve → Run

Before work that can cost money, change many nodes, or trigger important side effects, the Agent should expose a compact production plan.

Example:

```text
Production plan

3 shots
- Shot 01: new video generation
- Shot 02: reuse existing asset
- Shot 03: new video generation

1 key visual
- reuse current image result

Provider / model
- Seedance …
- GPT Image …

Estimated paid calls
- 2 video
- 0 image

[Run]
```

The product contract is:

- explain what will run;
- identify what can be reused;
- surface provider/model choice when it matters;
- surface cost/rate information when known;
- require a new decision when scope, account or budget materially changes.

This is a user-facing production contract, not a raw execution log.

## 5. Selective re-run should become a first-class promise

A major advantage of a graph over chat-only creation is that the system knows dependencies.

Target interaction:

```text
Change one node
      ↓
mark only affected descendants stale
      ↓
preserve accepted upstream / unrelated results
      ↓
re-run the minimum required work
```

User-facing copy can eventually be as simple as:

> Change one node. Re-generate only what changed.

Requirements before making that claim:

- explicit result/version identity;
- dependency tracking;
- stable references to accepted outputs;
- visible stale state;
- no silent replacement of accepted assets;
- reproducible selective-run tests.

## 6. Feedback should be attached to the production object

A useful Agent studio lets the human point at the work instead of repeatedly re-describing it in chat.

Candidate interaction objects:

- Node Comment;
- Artifact Comment;
- Region Comment for image results;
- Time-range / frame comment for video results.

Structured shape:

```text
target: node/result
location: optional region or time range
request: user feedback
status: open | resolved
created_at
resolved_by: operation/run reference
```

Then the Agent can operate on “3 unresolved feedback items” rather than receiving context-free messages.

This reinforces the core Flovart promise: human judgement and Agent execution happen on the same production state.

## 7. Skill-first Agent entry, Studio-first human experience

For Agent users, installation should converge toward a one-step Skill/CLI entry when packaging supports it:

```text
Install / enable Flovart Skill
→ Agent verifies Flovart executable/runtime
→ open or create a project
→ give a brief/reference
→ Agent builds the live Workflow
→ open Flovart to inspect/edit/run
```

For normal visual creators, the app remains the product surface. They should not need to understand Skill installation, MCP, operation names or runtime topology.

The Skill is the Agent's **knowledge + capability entry**.  
The Flovart canvas/workspace is the user's **production surface**.

Both must resolve to the same Workflow authority.

## 8. README / launch information order

Prefer:

```text
Outcome promise
→ one complete Hero demo
→ 2–3 concrete use cases / variants
→ quick start
→ why Flovart is different
→ human + Agent shared Workflow
→ reusable / selective production
→ providers and compatibility
→ architecture / security / limitations
```

Keep current evidence discipline, but move detailed caveats after the user understands the value. Do not weaken support-status labels or invent current generation capability.

## 9. Suggested initial showcase

A single showcase should prove the complete product thesis.

Example: three-shot product clip.

```text
"Make a 3-shot minimal product video from these references."
      ↓
Agent builds:
Reference → KV → Shot 1 / Shot 2 / Shot 3 → Output
      ↓
User changes Shot 2 direction
      ↓
Agent re-runs only Shot 2 and dependent output
```

Show:

- the natural-language request;
- the visible graph being created;
- a real generated result when available;
- human intervention on the same graph;
- selective regeneration;
- the resulting reusable Workflow.

## 10. Non-goals

This proposal does **not** recommend:

- inventing a new DSL when the Workflow graph already carries the needed semantics;
- copying another product's viral-growth claims;
- hiding provider costs or generation uncertainty;
- replacing current typed operations with screen automation;
- making the Agent a second source of project truth;
- claiming selective regeneration before dependency/version behavior is verified.

## 11. External reference patterns

Patterns reviewed while writing this note:

- Hypit Agent Quickstart: https://hypit.ai/quickstart/
- Hypit Agent usage guide: https://hypit.ai/guide/skill/
- Hypit Studio: https://hypit.ai/zh/quickstart/preview/
- Hypit repository / launch presentation: https://github.com/hypit-ai/hypit

The intent is to borrow the **product logic** — low-friction Agent entry, a visible editable workspace, reusable artifacts, plan-before-paid-work, and outcome-first storytelling — without copying its video DSL or claims.
