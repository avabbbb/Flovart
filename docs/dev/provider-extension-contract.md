# Provider Extension Contract

G4 将 Provider 扩展分成两层：正式 Provider 仍由 Flovart 维护，用户线路通过 `UserScriptProviderAdapter` 注册。两层都在 `CanonicalGenerationInput` 之后工作；Provider 不读取 Workflow 节点、连线、React store 或 PromptBar 状态。

## Official adapter

`services/providerGenerationAdapter.ts` 是正式 Provider 的 canonical capability/serialization seam；任务生命周期（submit/poll/cancel/reconcile）在 `services/aiGateway.ts` 的 `executeUnifiedIgnition` 内按 route 直接分派。`services/providerAdapter.ts` 仅保留共享类型（`ProviderTaskHandle`/`ProviderCancelResult`/`ProviderUsageResult` 等）。两者都只消费已解析的输入，不负责发现 Canvas 引用。

## User Script adapter

第一版“脚本”是受限 JSON mapping DSL，不执行任意 JavaScript：

```ts
{
  id: 'my-provider',
  endpoint: 'https://api.example.com/v1',
  capabilities: ['image-edit'],
  supportedReferenceKinds: ['image'],
  supportedReferenceRoles: ['reference', 'character'],
  maxReferences: { image: 4, video: 0, audio: 0 },
  auth: { header: 'Authorization', prefix: 'Bearer ' },
  request: {
    method: 'POST',
    path: '/images/edit',
    body: {
      model: { $path: 'input.parameters.modelId' },
      prompt: { $path: 'input.prompt' },
      references: {
        $map: {
          path: 'input.references',
          item: { url: { $path: '$item.href' }, role: { $path: '$item.role' } }
        }
      }
    }
  },
  response: { kind: 'image', base64Path: 'data.0.b64_json' }
}
```

Mapping context 只有脱敏的 `input`：节点 ID、prompt、canonical parameters、文本输入和已物化的 `GenerationReference`。它没有 Canvas state、React/localforage、Provider key、文件系统或任意 fetch 能力。凭据只由宿主在发出最终 HTTP request 时按 `auth` 声明注入。

endpoint 必须是 HTTPS 公网地址；request/poll/cancel path 只能留在同一 endpoint 下；媒体结果只允许 HTTPS 或 data URL。轮询和取消是声明式 path/response parser，不允许把任意 URL 或代码交给运行时。

用户线路通过 `registerUserScriptProvider()` 安装，通过 `extraConfig.providerScriptId` 绑定到 `UserApiKey`。未绑定脚本时仍走正式 adapter；脚本能力不满足时明确失败，不退化为其它生成模式。
