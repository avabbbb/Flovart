# Codex Final Certification Package

This package is intentionally a checklist and read-only runner path. It does
not log in, change Codex credentials, publish a release, or use a paid
provider. Until a real logged-in transcript is attached, Codex remains
`Experimental` in the support matrix.

## Preflight

Run from a clean candidate checkout:

```powershell
codex --version
codex login status
npm run version:check
npm run release:red-team
```

`codex login status` must report a ready account. If it reports `Not logged
in`, stop the certification; do not put credentials in a transcript or issue.

## Tracer bullet

In a new Codex conversation, invoke the installed Flovart Skill and ask:

```text
打开 Flovart，检查当前画布；只创建两个本地测试节点并连接它们，先不要调用真实 Provider。
```

Capture:

1. Skill discovery/installation result;
2. `status` and `start --open` output when startup is needed;
3. Browser binding readiness;
4. `workflow.inspect` before and after;
5. one `workflow.apply` receipt;
6. one local fixture `workflow.node.run` result;
7. Browser screenshot or DOM evidence;
8. final project/workflow state hash.

The transcript must demonstrate zero manual URL, token, port, JSON, or project
registration steps. It must not contain API keys or bootstrap secrets.

## Certification status

| Item | Status | Required external evidence |
| --- | --- | --- |
| Codex executable discovery | Local executable `codex-cli 0.149.1` observed | Stable PATH installation on target machine |
| Codex login | Not logged in during this pass | User login and a redacted `codex login status` result |
| Flovart Skill projection | Local contract checked | Same projection from the candidate release package |
| Browser Workflow tracer | Prepared, not authenticated externally | New-conversation transcript and visible Browser evidence |
| Paid Provider generation | Not attempted | Separate real-provider certification |

Do not mark this package complete from unit tests or an internal mock Codex.
