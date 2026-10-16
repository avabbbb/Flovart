# PromptAsset Contract

`PromptAsset` 是可复用的 provider-neutral 创作输入，不是 Provider 配置，也不是执行任务。它可以来自内置快速提示词、本地库、用户内容或远程社区包。

```ts
interface PromptAsset {
  id: string;
  title: string;
  text: string;
  tags: string[];
  modality: 'text' | 'image' | 'video' | 'audio' | 'mixed';
  modelHints?: string[];
  requiredReferenceRoles: string[];
  optionalReferenceRoles: string[];
  source: { kind: 'bundled' | 'local' | 'remote' | 'user'; id: string; label?: string; url?: string };
  examples: Array<{ title?: string; text: string }>;
}
```

Workflow PromptBar、内置 Assistant 或外部 Agent operation 可以消费 PromptAsset 的文本、标签和引用角色，再交给既有 `PromptIntent → GenerationReference[] → CanonicalGenerationInput`。Asset 不得保存 API Key、Authorization、Provider wire body 或私有文件路径。归一化器会过滤未知引用角色，并拒绝明显的凭据文本。

Agent Integration Skill 与 PromptAsset 是两种不同层次：Skill 描述外部 Agent 如何安全调用 Flovart，PromptAsset 描述一段可插入的创作输入。历史 Production Skill / recipe 可以作为实验内容存在，但不是 PromptAsset 的正式并列产品层，也不能替代 Runtime、Mutation Core 或 Provider Adapter。
