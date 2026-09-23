# Flovart Studio Host Packages

Status: **EXPERIMENTAL HOST PROJECTIONS**. This directory contains thin host entry points around the same Flovart generation and Workflow authority. A package build, manifest check or injected bridge test is not real-host certification.

## Product boundary

Creative-host integrations have three distinct surfaces:

| Surface | Purpose | Authority |
| --- | --- | --- |
| Host light panel / Workflow Integration | Current selection → intent/reference → generate → import | Flovart business/runtime path; no second Workflow |
| Native effect / OFX | Persist parameters and a fixed artifact version for preview/export | Host project + durable local artifact |
| Flovart Canvas | Complex graph editing, dependencies, versions and Agent collaboration | Canonical visible Workflow |

Do not collapse these into one “plugin” claim.

The light-panel path is:

```text
host selection
  -> CreativeHostAdapter
  -> WorkflowResourceReference
  -> CanonicalGenerationInput
  -> existing generation / Provider path
  -> durable FlovartArtifact
  -> host import as a new result
```

The panel never reads Provider credentials and never calls a Provider directly.

## UI contract for light panels

A host panel should remain smaller and more native-feeling than the full Flovart app. The first screen contains only:

1. current host selection/context;
2. prompt / creative intent;
3. optional extra references or short recipes;
4. model choice (Auto by default);
5. output destination;
6. a single Generate/Add action;
7. truthful progress/error/recovery state.

Rules:

- match host theme, density, focus and resize behavior;
- keep branding low-weight;
- default to adding a new layer/asset/Media Pool item;
- do not silently overwrite the selected source;
- paid/multi-result work may show a compact plan before running;
- complete history, dependency graphs and complex iteration open the same Flovart Canvas;
- internal Link/Lease/port/transport details stay out of the normal UI.

## Host notes

### After Effects

The checked-in panel is currently **CEP/ExtendScript-based and Experimental**. It is a light contextual entry, not a native effect.

The native-effect slice under `after-effects/effect/` uses the C++ Effect SDK direction and should rely on host-native Effect Controls / Timeline / Composition interactions for persisted parameters and keyframes. Do not assume After Effects is a supported UXP host until Adobe's current AE developer documentation explicitly says so.

### DaVinci Resolve Studio

The Resolve package is a **Workflow Integration** app, opened from `Workspace > Workflow Integrations`; it is not a claimed Inspector-native panel.

Current implementation uses an Electron sandboxed model with `contextIsolation`, preload + `contextBridge`, and renderer-side Node integration disabled. For Resolve versions exposing Promise scripting APIs, prefer async calls so the UI does not block on long scripting work.

The planned Resolve OFX path is separate from this Workflow Integration package.

## Current support

| Host | Package | Evidence | Release status |
| --- | --- | --- | --- |
| Photoshop | `dist-studio/photoshop` | manifest/build checks and shared host contract tests | Experimental; real host is an External Gate |
| Premiere Pro | `dist-studio/premiere` | manifest/build checks and shared host contract tests | Experimental; real host is an External Gate |
| After Effects | `dist-studio/after-effects` | CEP panel manifest/build checks and injected bridge contract | Experimental; real CEP/ExtendScript host is an External Gate |
| DaVinci Resolve Studio | `dist-studio/resolve` | Workflow Integration package/build checks and injected bridge contract | Experimental; real Studio host is an External Gate |

Build the panel packages with:

```bash
npm run studio:build
```

Real-host evidence must follow the per-host checklists in this directory. Support status is owned by [SUPPORT_MATRIX.md](../../SUPPORT_MATRIX.md); the current product/UI boundary is owned by [the main design](../../docs/design/flovart-native-effects.md).
