# Flovart Creative Host Matrix

状态：E0 真实 package/contract 审计。

| Host | Adapter | 当前包/证据 | 当前状态 | 首条 Golden Path |
| --- | --- | --- | --- | --- |
| Premiere Pro 25.6+ | `CreativeHostAdapter` + UXP Panel | `integrations/studio/premiere/`、`integrations/studio/shared/host-contract.js`、package/contract tests | Experimental | Selected Clip → Flovart reference → Artifact → Project import |
| Photoshop | `CreativeHostAdapter` + UXP Panel | `integrations/studio/photoshop/`、shared host contract | Experimental | Active Layer → reference → Artifact → new layer |
| After Effects | `CreativeHostAdapter` + CEP/ExtendScript bridge | `integrations/studio/after-effects/`、`cep-bridge.js`、`host.jsx` | Experimental | Active Layer → reference → Artifact → footage/layer |
| DaVinci Resolve Studio | `CreativeHostAdapter` + Workflow Integration | `integrations/studio/resolve/`、`main.js`、manifest | Experimental | Selected Clip → reference → Artifact → Media Pool |

## Adapter boundary

```ts
getContext()
getSelection()
materializeSelection(selection)
importArtifact(artifact, target?)
subscribeContext?(listener)
```

Adapter 不实现 `generate()`、Provider routing、Prompt semantics、Cost Gate 或 Workflow mutation。Host selection 先变成 provider-neutral `WorkflowResourceReference`，再交给现有 resolver/executor。

## Certification law

Manifest、shared UI、mock、fake Provider、build 和 contract test 只能证明 package shape。真实宿主安装、选区、素材复制/导入、撤销、保存重开和导出必须在对应宿主中完成，才能提升状态。

## Premiere priority

Premiere 是第一条 Production tracer，因为它最直接证明：

```text
Clip → Flovart → Artifact → back to Project
```

无 Premiere 安装时继续完成 mock contract、manifest/build 和人工 certification checklist，但不要伪称已完成真实闭环。
