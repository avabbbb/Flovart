# Flovart Runtime / RunningHub 模型映射测试报告

## 测试信息

- 日期：2026-08-03
- 项目：`H:\WorkSpace_For_VsCode\React\Floavrt`
- 测试目标：验证 Desktop Runtime 已连接时，RunningHub 的非敏感产品模型和 Provider Route 是否能进入网页“模型映射”推荐。
- 付费安全：本轮没有调用 `generate.image`、`generate.video` 或 `production.run`；Provider 只被读取状态，没有产生付费任务。

## 环境检查

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| Runtime 连接 | PASS | `runtime.status` 返回 `state=ready`、`authority=desktop-runtime` |
| RunningHub 凭证 | PASS | `provider.status` 返回 `ready=true`、1 个安全凭证 |
| RunningHub 路线目录 | PASS | 返回 4 条图片/视频路线，包含 G-2、Grok 文生/图生、Veo Lite |
| Google 未配置状态 | PASS | `credentials=[]`、`ready=false`；release-5 UI 不显示未配置卡片 |
| 可见 Workflow | PASS | `workspace.status` 返回 `state=ready`、`hasWorkflow=true` |

当前 Runtime 返回的 RH 路线：

- `flovart:gpt-image-2` → `rhart-image-g-2/text-to-image`
- `flovart:grok-imagine-video-1.5` → `rhart-video-g/text-to-video`
- `flovart:grok-imagine-video-1.5` → `rhart-video-g/image-to-video`
- `flovart:veo-3.1-lite` → `rhart-video-v3.1-lite-official/text-to-video`

## 自动化测试

测试文件：`tests/runtimeModelMappingSync.test.tsx`

执行命令：

```text
npm test -- --run tests/runtimeModelMappingSync.test.tsx tests/productModelCatalog.test.ts tests/routeMapping.test.ts tests/settingsPanelProviderUi.test.tsx
```

结果：

- 4 个测试文件通过
- 32 项正常断言通过
- 1 项 `it.fails` 预期失败，准确锁定当前缺陷
- 1 个 BAD CASE 复现测试通过
- `npx tsc --noEmit` 通过
- `git diff --check` 通过；仅有既存的 CRLF/LF 转换提示

## BAD CASE

### BC-RH-001：Runtime-only RunningHub 没有模型映射推荐

**前置条件**

- `provider.status` 返回 RunningHub `ready=true`。
- Runtime 返回 `productModels` 和 4 条 `routes`。
- 网页端 `userApiKeys=[]`。

**操作**

1. 打开设置。
2. 点击“模型映射”。

**期望结果**

模型映射页至少显示一组不含 Secret 的 Runtime 路线建议，例如：

```text
Runtime 路线建议
flovart:gpt-image-2 → rhart-image-g-2/text-to-image
```

同时应明确标记这只是 Production Runtime 路线，不能伪装成浏览器直连 API Key。

**实际结果**

页面显示：

```text
请先在“API 配置”中添加 Provider，随后再建立模型映射。
```

没有显示 Runtime 路线建议。

**结论**

FAIL，严重度 P1。Runtime 已有 RH 凭证和路线，但 `RouteMappingEditor` 只读取网页 `userApiKeys`，没有消费 Runtime `productModels/routes`。

### BC-RH-002：只有 Runtime 凭证时，浏览器路由解析被阻止

**操作**

使用空网页 Key 列表解析 `flovart:gpt-image-2 × text-to-image`。

**实际结果**

`resolveRouteMapping(..., [])` 和 `resolveProductModelRoute(..., [])` 都返回 `null`。

**结论**

PASS，属于正确的安全拒绝。Runtime Secret 不应被伪造成网页 `UserApiKey`，否则会越过本地安全边界。当前问题是 UI 没有给出 Runtime-only 的非敏感路线建议，导致用户把安全拒绝误认为凭证失效。

### BC-RH-003：网页端有 RH Key 时，推荐算法正常

**操作**

使用脱敏测试 Key，并提供上述 4 个 RH Route ID，调用 `suggestProductRouteMappings`。

**实际结果**

成功生成 G-2 文生图、Grok 文生视频和 Grok 图生视频等映射建议。

**结论**

PASS。RunningHub Route Catalog 和现有推荐算法本身不是主要故障点；断点在 Runtime 状态到网页映射中心之间。

### BC-RH-004：未配置 Google 的状态展示

**前置条件**

- Google `ready=false`。

**实际结果**

release-5 设置页不再显示 Google 未配置卡片；Runtime 内部 `provider.status` 仍保留可选 Google 能力记录。

**结论**

PASS，符合当前选择的“只隐藏未配置项”范围；不代表 Google Runtime 代码已经彻底删除。

## 根因判断

| 假设 | 结果 | 证据 |
| --- | --- | --- |
| 映射页没有读取 Runtime 路线 | 确认 | Runtime 有路线，UI 仍显示网页 Key 为空 |
| 前端状态类型/组件链丢弃 Runtime 路线 | 确认 | `SettingsPanel` 只把 Runtime status 用于凭证卡片，`RouteMappingEditor` 只收 `userApiKeys` |
| RH Route ID 与本地 Catalog 不一致 | 排除 | 带相同 Route ID 的网页测试 Key 能生成建议 |
| Runtime-only Key 不应直接进入网页映射 | 确认 | 空网页 Key 的路由解析被正确阻止，符合安全边界 |

## 待修复项

1. 增加 Runtime 非敏感路线建议模型，将 `productModels`、`mode`、`routeId`、稳定性和价格预览状态传入模型映射页。
2. 明确“同步”语义：只读展示/写入 Runtime Route Mapping/要求另存网页 Key，三者不能混为一个 `UserApiKey`。
3. 为 Runtime-only RH 增加一条绿色可用路线状态，并把浏览器直连限制写在路线旁边，而不是只显示“请添加 Provider”。
4. 修复后保留 BC-RH-001 作为回归测试：修复前 `it.fails` 应失败，修复后应转为正常通过断言。

