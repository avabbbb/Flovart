# Flovart Creative Host Matrix

本页保留当前面板包的代码审计与导入验证边界，不是原生效果支持声明。新效果的 AE/PR 优先顺序及保存、关键帧、离线渲染验收统一见[主设计](../flovart-native-effects.md)。

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

现有面板的首次导入验证优先 Premiere；这不改变新原生效果先 AE 小样、再验证 PR 复用的顺序。此处只证明：

```text
Clip → Flovart → Artifact → back to Project
```

无 Premiere 安装时继续完成 mock contract、manifest/build 和人工 certification checklist，但不要伪称已完成真实闭环。
