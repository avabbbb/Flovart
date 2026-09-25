# Flovart Studio Host Packages

The current experimental panels provide a contextual inspector. A creative host supplies its current
document and selection; Flovart Link registers that selection as a
provider-neutral `creative-host` resource, runs the existing Workflow command
and execution path, then asks the host adapter to import the returned artifact.

```text
host selection
  -> CreativeHostAdapter
  -> WorkflowResourceReference
  -> ExecutableResourceResolver
  -> CanonicalGenerationInput
  -> WorkflowExecutor / Provider Adapter
  -> FlovartArtifact
  -> host import
```

The packages in this directory never read Provider credentials and never call a
Provider directly. The panel waits for a Link-injected controller and
materialization/import callbacks; a package build or a mock contract test is
not a real host certification.

These panels are not native effects. The After Effects package also carries an
uncompiled C++ Effect SDK source prototype and an explicit candidate-apply bridge;
neither is a built or host-certified effect.

The current first-host direction is **DaVinci Resolve Studio 21.1 MCP-first**:
use Blackmagic's native MCP for Agent-side Resolve control, Flovart Skill/CLI for
generation and durable artifacts, and keep the Resolve Workflow Integration as a
thin human-review surface / measured fallback. See
[Resolve Product & UI Spec](resolve/PRODUCT_UI_SPEC.md) and the
[main design](../../docs/design/flovart-native-effects.md).

Existing selection/import checks do not certify real native MCP connectivity,
timeline mutation safety, OFX parameters, project reopening or offline effect export.

## Current support

| Host | Package | Evidence | Release status |
| --- | --- | --- | --- |
| Photoshop | `dist-studio/photoshop` | manifest/build checks and shared host contract tests | Experimental; real host is an External Gate |
| Premiere Pro | `dist-studio/premiere` | manifest/build checks and shared host contract tests | Experimental; real host is an External Gate |
| After Effects | `dist-studio/after-effects` | CEP panel and uncompiled Effect SDK source package; real CEP bridge and `.aex` build remain External Gates | Experimental; real CEP/ExtendScript host is an External Gate |
| DaVinci Resolve Studio 21.1 | native MCP + `dist-studio/resolve` | native MCP is the preferred Agent control path; panel package/build and injected bridge remain implementation evidence only | Experimental; real MCP connection + selection → artifact → Media Pool tracer is an External Gate |

Build the available panel packages with:

```bash
npm run studio:build
```

Follow the [Photoshop checklist](PHOTOSHOP_REAL_HOST_CHECKLIST.md), [Premiere
checklist](PREMIERE_REAL_HOST_CHECKLIST.md), [After Effects
checklist](AFTER_EFFECTS_REAL_HOST_CHECKLIST.md), and [Resolve
checklist](RESOLVE_REAL_HOST_CHECKLIST.md) for real-host evidence. Package and
injected-bridge checks do not certify a host installation or a paid Provider.
