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

These panels are not native effects. The [main design](../../docs/design/flovart-native-effects.md)
defines the next direction: generate durable media through one shared task path,
then render a fixed version locally inside the host effect. Existing selection/import
tests do not certify effect parameters, keyframes, project reopening or offline export.

## Current support

| Host | Package | Evidence | Release status |
| --- | --- | --- | --- |
| Photoshop | `dist-studio/photoshop` | manifest/build checks and shared host contract tests | Experimental; real host is an External Gate |
| Premiere Pro | `dist-studio/premiere` | manifest/build checks and shared host contract tests | Experimental; real host is an External Gate |
| After Effects | `dist-studio/after-effects` | CEP panel manifest/build checks and injected bridge contract | Experimental; real CEP/ExtendScript host is an External Gate |
| DaVinci Resolve Studio | `dist-studio/resolve` | Workflow Integration package/build checks and injected bridge contract | Experimental; real Studio host is an External Gate |

Build the available panel packages with:

```bash
npm run studio:build
```

Follow the [Photoshop checklist](PHOTOSHOP_REAL_HOST_CHECKLIST.md), [Premiere
checklist](PREMIERE_REAL_HOST_CHECKLIST.md), [After Effects
checklist](AFTER_EFFECTS_REAL_HOST_CHECKLIST.md), and [Resolve
checklist](RESOLVE_REAL_HOST_CHECKLIST.md) for real-host evidence. Package and
injected-bridge checks do not certify a host installation or a paid Provider.
