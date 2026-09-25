# Flovart × DaVinci Resolve Studio 21.1 — Product & UI Spec

Status: **CURRENT IMPLEMENTATION REFERENCE**  
Authority: subordinate to docs/design/flovart-native-effects.md  
Target: **DaVinci Resolve Studio 21.1 first**  
Updated: 2026-09-25

This document defines the first Resolve-specific product slice, panel interaction and visual direction. It exists so implementation Agents do not invent a second editor, a chat product, or a generic web dashboard inside Resolve.

If this file conflicts with the main product design, the main design wins.

---

## 1. Why Resolve is first now

DaVinci Resolve Studio 21.1 changes the shortest path to a real Flovart host demo.

Blackmagic Design's 2026-09-08 Studio 21.1 release adds **AI assistant integration**, a native MCP server and new scripting APIs. The product direction is therefore:

~~~text
external Agent
     │
     ├── Resolve Studio 21.1 native MCP
     │      └── project / media pool / timeline / render operations
     │
     └── Flovart Skill + CLI
            └── generation / references / durable artifacts / Workflow

                 ↓

         the same Resolve project
~~~

The first milestone does **not** require Flovart to recreate Resolve's MCP server, expose hundreds of Resolve tools, or finish an OFX effect.

After Effects work remains Experimental and is not deleted; it is paused as the blocking first host while the Resolve-first vertical slice is proven.

### Official facts to treat as current

- Resolve **Studio 21.1** adds AI assistant integration and a native MCP server.
- Blackmagic's support page describes Studio 21.1 as adding AI assistant integration and 20 new scripting APIs.
- The Studio capability requires a Studio license; do not claim the Free edition has the same native MCP path.
- The current user flow reported for the native integration is File > Setup AI Assistants; verify it against the installed build before documenting screenshots or exact assistant names.

### Community observations: useful, not product contracts

Recent direct inspection of the 21.1 MCP reports a deliberately small tool surface centered on API/document discovery and script execution instead of one MCP tool per Resolve action. Treat the exact tool count and names as **observed implementation detail**, not a stable Flovart contract.

A Windows community test also reports UTF-8/CJK issues in generated Python unless the assistant process uses UTF-8-safe handling. Reproduce locally before adding a workaround to Flovart.

---

## 2. Product promise

First user-facing promise:

> **Select a clip in Resolve. Ask your Agent or Flovart for a new version. Review it, then bring it back to the Media Pool without leaving the edit.**

The product is not:

- “ChatGPT inside Resolve”;
- a second timeline;
- a second Media Pool;
- a second Agent host;
- an MCP manager UI;
- an OFX marketplace;
- a copy of the full Flovart Canvas in a 320px panel.

The panel is a **contextual production inspector**.

The Agent does reasoning in its existing host. Resolve owns edit state. Flovart owns generation tasks and durable generated artifacts.

---

## 3. First vertical slice

P0 Golden Path:

~~~text
Resolve Studio 21.1 running
        ↓
user selects one Media Pool clip or timeline item
        ↓
Flovart panel shows the exact current selection
        ↓
user enters intent OR asks external Agent
        ↓
Flovart prepares one generation plan
        ↓
user approves paid generation when required
        ↓
one durable result is generated
        ↓
user reviews candidate
        ↓
Add to Media Pool
        ↓
result appears in the current Resolve project
~~~

P0 ends here.

P1:

~~~text
candidate
→ Add to new video track
→ preserve source clip
~~~

P2:

~~~text
candidate
→ explicit Replace / Commit
→ target identity rechecked immediately before mutation
→ recoverable / undo-aware behavior
~~~

Do **not** make timeline replacement the first success condition.

---

## 4. Surface architecture

### 4.1 Native Resolve MCP — Agent control plane

Use Blackmagic's native MCP first for host operations when the installed Studio build exposes the required capability.

Responsibilities:

- inspect project / timeline / current selection;
- search current Resolve scripting docs when needed;
- perform bounded Resolve scripting operations;
- import media;
- later add to timeline / render after the corresponding safety gate.

Flovart must not wrap every Resolve API method as a new Flovart MCP tool.

Preferred pattern:

~~~text
Agent
→ inspect/search current Resolve API
→ prepare a bounded script/action
→ execute through native Resolve MCP
→ verify resulting project state
~~~

If the native MCP is insufficient for one required operation, record the concrete gap before adding a custom bridge.

### 4.2 Flovart Skill + CLI — generation plane

Responsibilities:

- understand Flovart operation semantics;
- prepare references;
- start/query/cancel generation;
- preserve provider task identity;
- materialize durable artifact versions;
- open the full Flovart Workflow only when the task becomes genuinely complex.

The Skill should teach the Agent how to combine **Resolve MCP + Flovart CLI**. It should not duplicate Resolve's API reference.

### 4.3 Flovart Resolve panel — human review plane

The panel exists for:

- current context;
- prompt / references;
- cost/plan review;
- task status;
- candidate review;
- explicit import/apply actions;
- “Open in Flovart”.

It does **not** own the Agent conversation.

### 4.4 OFX — later, only if proven necessary

OFX remains a separate later slice for fixed-version rendering / host-persisted effect parameters.

Do not make OFX a prerequisite for the first Resolve MCP demo.

---

## 5. Visual direction

### Primary visual reference: Resolve Inspector

Blackmagic's Inspector pattern is the strongest reference for the Flovart panel:

- dense single-column hierarchy;
- parameters grouped into collapsible sections;
- current selection drives what is shown;
- dark neutral surfaces;
- small type and restrained separators;
- controls align to a predictable label/value rhythm;
- no marketing card grid inside the working UI.

Flovart should feel like a **good Resolve-native utility with Flovart identity**, not a website iframe.

### Secondary visual references

- **Media Pool**: thumbnails are functional, compact and metadata-led.
- **Cut page**: space is treated as expensive; actions should have direct results and avoid setup-heavy screens.
- **Resolve toolbar / Inspector**: iconography and state changes are quiet; strong accent is reserved for meaningful actions/state.
- Community Resolve MCP control panels may be studied for diagnostics/recovery patterns, but they are not the visual target.

### Proposed panel sizing

These are Flovart design targets, not Blackmagic requirements:

- default width: **340–380 px**;
- minimum usable width: **280 px**;
- single vertical scroll area;
- header: compact, no large logo treatment;
- 8–12 px spacing rhythm;
- body copy approximately 11–12 px equivalent;
- thumbnail: enough to identify the selected clip, not a mini viewer;
- one dominant CTA per state.

The panel must remain usable when resized narrow and must not require horizontal scrolling.

---

## 6. Panel information architecture

Do not keep generic top-level “制作 / 历史” tabs merely because the shared panel already has them.

Resolve-first hierarchy:

~~~text
Flovart                              ● Ready
────────────────────────────────────────────

CURRENT CLIP
[ thumb ]  Interview_A_003.mov
           Timeline 1 · V1
           00:01:12:08 – 00:01:17:08

GENERATE
┌──────────────────────────────────────────┐
│ Replace the background with...           │
│                                          │
└──────────────────────────────────────────┘
[ Current clip ] [+ Reference]

Model                              Auto ▾
Output                       Media Pool ▾

[ ✦ Generate candidate ]

TASK
Generating · 42%                         ×

CANDIDATES
┌──────────────────────────────────────────┐
│ [16:9 thumb]  V2                        │
│ Seedance · 5s · ready                   │
│ [Preview]              [Add to Media Pool]
└──────────────────────────────────────────┘

────────────────────────────────────────────
Open in Flovart ↗
~~~

When no candidate exists, do not show an empty “History” product area.

When multiple candidates exist, show them inline below Task or behind a lightweight “Candidates N” disclosure.

---

## 7. Component specification

### 7.1 Connection/status header

Display only actionable status:

- ● Resolve connected
- ● Flovart ready
- ○ Flovart unavailable — Reconnect
- ○ Resolve Studio 21.1 MCP not configured — Setup guide

Do not show:

- raw ports;
- lease IDs;
- MCP JSON;
- session tokens;
- internal bridge names.

When an external Agent is currently associated, Agent · Codex is enough. Do not embed its full chat.

### 7.2 Current Clip

Always first.

Required display:

- small thumbnail if cheaply available;
- clip/item name;
- project/timeline context;
- captured time range or current frame;
- source type: Media Pool / Timeline;
- stale-selection warning when context changed.

The selection identity used by a pending task must be captured separately from the currently highlighted UI selection.

### 7.3 Prompt

One plain-language field.

Placeholder should describe an outcome, for example:

> Describe the new shot, motion, lighting or change…

Do not put a system-prompt editor, negative-prompt wall, JSON parameters or Agent instructions in the primary panel.

### 7.4 References

Current clip is visually represented as the first reference chip.

Additional references use compact chips / thumbnails.

Reference ordering must be visible when order matters.

### 7.5 Model

Default: Auto.

Expand model/provider only when the user requests control or Auto cannot resolve a compatible route.

Provider credentials stay in Flovart settings, never in Resolve panel fields.

### 7.6 Output

P0: **Media Pool** must be the real default and visible option.

The current shared panel implementation passes { kind: 'media-pool' } for Resolve while its generic output select does not create a matching Media Pool option. Treat this as a concrete implementation defect to fix before real-host UX certification.

P1 may add Media Pool / New video track.

P2 may add Replace selected clip… .

The replace action must remain visually distinct and require a fresh target check.

### 7.7 Plan / cost

Before paid generation, show a compact summary only when needed:

~~~text
1 video generation · 5s
Seedance …
Estimated cost: …

[Generate]
~~~

Do not make users approve a verbose technical plan for every free/read-only step.

### 7.8 Task

Task states:

- preparing;
- awaiting approval;
- submitting;
- generating;
- downloading;
- ready;
- cancel requested;
- unknown after submit;
- failed.

If progress is unknown, use an honest indeterminate state. Never animate fake percentage.

Cancellation keeps the provider task identity for later query/recovery.

### 7.9 Candidate card

Each candidate should show:

- preview thumbnail / poster frame;
- version label;
- duration/resolution when known;
- model label;
- readiness;
- one primary next action.

P0 primary action: **Add to Media Pool**.  
Secondary: Preview.

Do not put five equally strong buttons on every card.

### 7.10 Open in Flovart

Persistent low-weight footer action: **Open in Flovart ↗**.

Use it for:

- multi-shot workflows;
- dependency editing;
- reference ordering;
- version comparison;
- complex model routing.

Opening Flovart should preserve the same task/artifact context.

---

## 8. Interaction states

### No project

Open a Resolve project to use Flovart. No empty form.

### Project, no selection

Select a Media Pool clip or timeline item. No Generate button.

### Ready

Current clip + prompt + one CTA.

### Agent initiated task

If an external Agent prepared work:

~~~text
Codex prepared 1 generation
Current clip: Interview_A_003.mov
[Review & Generate]
~~~

Do not auto-submit a paid generation because the Agent asked.

### Running

Freeze the captured target label in the task row.

The user may continue selecting other clips in Resolve; the pending task must not retarget.

### Ready candidate

Candidate is non-destructive.

P0 never overwrites timeline state.

### Disconnected

Preserve draft prompt/reference choices where safe and offer one recovery action.

---

## 9. Agent + human safety policy

| Action | Default |
| --- | --- |
| Read project / selection / metadata | automatic |
| Search Resolve API/docs | automatic |
| Prepare Flovart generation plan | automatic |
| Paid generation | confirm if outside already approved scope |
| Import result to Media Pool | low-risk; allowed after generation intent |
| Add candidate to new track | explicit user/Agent instruction |
| Replace existing timeline item | confirm + recheck target identity |
| Delete clips/tracks/timelines | confirm |
| Render/export to a new path | explicit instruction |
| Overwrite existing deliverable | confirm |
| Resolve unsafe arbitrary script / filesystem/network escape | deny by default |

If the installed native MCP exposes both bounded and unsafe script execution, use the bounded path by default.

Do not silently enable a broad unsafe executor to make a demo work.

---

## 10. MCP design rule: small stable surface, dynamic API knowledge

The first-party Resolve 21.1 MCP is valuable partly because the Agent can inspect current API/documentation instead of Flovart freezing a huge copy of Resolve into its own tool schema.

Flovart should learn from that pattern:

- stable tools stay small;
- domain procedure lives in Skill;
- current host API comes from the host / current docs;
- app-specific business safety stays in Flovart;
- a new wrapper tool needs a repeated product reason, not just API availability.

Do not create resolve.clip.trim, resolve.clip.move, resolve.clip.foo wrappers for every scripting method before a user flow needs them.

---

## 11. Hero demo contract

Target demo: **20–35 seconds**, one believable operation.

~~~text
1. Resolve Edit page, one timeline clip selected.
2. External Agent receives:
   "Make a rainy-night version of this shot. Keep the duration."
3. Agent reads Resolve context via native MCP.
4. Agent invokes Flovart generation path.
5. Flovart panel shows the frozen target + real task status.
6. Candidate appears.
7. User clicks Add to Media Pool.
8. Resolve Media Pool visibly receives the asset.
9. Optional P1 beat: add to a new upper track.
~~~

The demo must show the real host and real result path. Speed-up waiting is allowed only if labelled.

Do not make “automatic replacement” the first Hero; non-destructive import is easier to trust and easier to verify.

---

## 12. Implementation order

### R0 — environment / official MCP

- Verify installed product is **Resolve Studio 21.1**.
- Run File > Setup AI Assistants.
- Verify one real Agent connection.
- Record exact MCP tool surface from the installed version.
- Test English + Chinese project/bin/marker text on Windows; only add UTF-8 mitigation if reproduced.

### R1 — native MCP + Flovart, no custom panel dependency

Golden task:

~~~text
read current selection
→ generate one local/fake deterministic artifact through Flovart
→ import artifact to Media Pool
~~~

This proves orchestration before UI polish.

### R2 — panel UI

Refactor the Resolve panel to this spec:

- Current Clip;
- Generate;
- Task;
- Candidates;
- Open in Flovart.

Fix the Media Pool output-select mismatch.

Use real host context; no mock-only screenshots as completion evidence.

### R3 — one real Provider

One approved RunningHub generation:

~~~text
selected clip
→ reference materialization
→ paid generation
→ durable artifact
→ Media Pool
~~~

Verify cancellation, unknown-submit recovery and file lifetime.

### R4 — new track

Add candidate to a new track without deleting/replacing the source.

### R5 — replace / commit

Only after target identity, undo/recovery and timeline mutation behavior are measured.

### R6 — OFX

Only after a real need exists for fixed-version effect parameters / keyframes / offline rendering.

---

## 13. Acceptance criteria

The Resolve-first slice is successful when all are evidenced on a real machine:

1. Resolve Studio 21.1 native MCP connects to one supported external Agent.
2. Agent can read the intended project/selection.
3. Flovart can create/query one generation without creating a second host state.
4. Target remains frozen if the user changes selection during generation.
5. Result becomes a durable Flovart artifact.
6. Result is imported into the correct Resolve Media Pool.
7. Original media/timeline is unchanged in P0.
8. Panel shows correct current clip, task and candidate state.
9. Panel remains usable narrow/wide and visually consistent with Resolve.
10. Flovart/Resolve disconnects fail visibly and recoverably.
11. Provider credentials and Agent credentials do not enter project metadata or screenshots.
12. The complete flow is recorded from the real host.

Only after this should the Support Matrix wording be upgraded.

---

## 14. Visual / interaction references

### Primary — Blackmagic Design

- Resolve Edit page: https://www.blackmagicdesign.com/products/davinciresolve/edit
- Resolve Cut page: https://www.blackmagicdesign.com/products/davinciresolve/cut
- Resolve Media page: https://www.blackmagicdesign.com/products/davinciresolve/media
- Resolve 21 / 21.1 What's New: https://www.blackmagicdesign.com/cn/products/davinciresolve/whatsnew
- Blackmagic Support / 21.1 manual and release downloads: https://www.blackmagicdesign.com/cn/support/

Use these for density, Inspector grouping, Media Pool treatment, working-surface hierarchy and wording style.

### Secondary — implementation research

- Community MCP with local control panel: https://github.com/samuelgursky/davinci-resolve-mcp
- Community CLI/MCP field guide: https://github.com/dmmdea/davinci-resolve-cli
- OpenFX specification (later phase only): https://github.com/AcademySoftwareFoundation/openfx

These are references for failure modes, guarded actions and observability. Do not copy their UI wholesale and do not replace Blackmagic's native MCP with a community server unless a measured gap requires it.

---

## 15. Non-goals for the first implementation Agent

Do not:

- restart AE native-effect work;
- build Resolve OFX;
- create a second Resolve MCP server;
- expose hundreds of Resolve API wrappers;
- embed an Agent chat in the panel;
- recreate Timeline / Media Pool / Inspector;
- add account/provider setup screens to Resolve;
- auto-delete or auto-replace source clips;
- use unsafe arbitrary script execution by default;
- make the panel look like Flovart's marketing site;
- claim Free Resolve support from Studio evidence.

The implementation Agent should prefer a boring, native-feeling panel with a spectacular end-to-end result over a spectacular panel with an unverified host path.
