# Release Candidate Plugin Isolation Evidence

## Node Plugin SDK

The reference Node Plugin SDK now has a small, testable lifecycle boundary:

- install rejects malformed contracts before registry insertion;
- enable/disable changes lookup without deleting the project node;
- update keeps the previous definition in an in-memory rollback stack;
- rollback restores the prior output/render definition;
- uninstall removes the registry definition/output while preserving the
  project node data;
- a renderer/panel/toolbar exception is caught by the node-local React error
  boundary and shown as `插件暂时不可用`; the surrounding Workflow remains
  mounted.

The registry still uses the existing Workflow Resource Contract and structured
`applyOps`; it does not create a second Workflow authority or let a plugin
write React state directly.

## Provider extension boundary

The current Provider extension is a declarative User Provider mapping rather
than an executable plugin. It is validated at registration, allows only HTTPS
public endpoints, disallows restricted headers and arbitrary JavaScript, and
keeps credentials out of the mapping input. Provider request/poll/cancel
failures are returned as generation failures and do not mutate the Workflow
authority directly. Its supported lifecycle is register/unregister/clear;
there is no separate process sandbox or stable provider-plugin marketplace
contract in this RC.

## Verification

```text
npx vitest run tests/nodePluginSdk.test.tsx tests/workflowEditor.test.tsx tests/userScriptProviderAdapter.test.ts --reporter=dot
  3 files passed, 52 tests passed

npx tsc --noEmit
  passed
```

The tests cover malformed renderer/version contracts, install/update/rollback,
enable/disable/uninstall preservation, plugin context snapshots and isolated
storage/events, HTTPS/path/header restrictions, canonical input mapping,
credential exclusion from mappings, async polling and cancellation.

## Known boundary

Node Plugins are currently in-process trusted code. The SDK context is a
capability reduction and failure-containment contract, not a memory or OS
permission sandbox. Do not claim third-party plugin isolation or arbitrary
plugin installation as Stable until a permission/trust model and sandbox are
implemented and certified.
