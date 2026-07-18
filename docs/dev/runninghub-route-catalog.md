# RunningHub 首期 Route Catalog

本清单锁定第一阶段可进入 `Verified Route` 评审的 16 条图片与普通视频线路。表中字段只是实现 Route Capability Schema 与 Route Contract Test 的最低契约锚点，不是可直接执行的完整 Schema；实现时仍须从对应官方页逐项编码枚举、必填性、默认值、媒体数量与序列化类型。只照抄示例请求或按 endpoint 名称用正则猜测的线路仍属于 `Discovered Route`，禁止执行。

## Product Model 身份依据

PromptBar 使用原始模型名，RunningHub 包装名只作为 Provider Route Label。以下身份均有 RunningHub 官方英文目录或详情页依据：

- GPT Image 2：[gpt-image-2.0/text-to-image-channel-low-price](https://www.runninghub.cn/runninghub-api-doc-en/api-448184541)
- Gemini 3.1 Flash Image / Nano Banana 2：[nano-banana2-gemini31flash/text-to-image-channel-low-price](https://www.runninghub.cn/runninghub-api-doc-en/api-448184538)
- Gemini 3.0 Pro Image / Nano Banana Pro：[nano-banana-pro/text-to-image-channel-low-price](https://www.runninghub.cn/runninghub-api-doc-en/api-448184536)
- Midjourney v8.1：[midjourney-text-to-image-v8.1](https://www.runninghub.cn/runninghub-api-doc-en/api-454760430)
- Veo 3.1 Fast：[google/veo3.1-fast/image-to-video-channel-low-price](https://www.runninghub.cn/runninghub-api-doc-en/api-448184374)
- Grok Imagine Video：[xai/grok-imagine/text-to-video-official-stable](https://www.runninghub.cn/runninghub-api-doc-en/api-448184433)
- Seedance 2.0 / Fast：对应 Route 的中文官方页直接以 seedance2.0 命名，具体链接见视频表。

## 图片 Route（6）

| Product Model | Generation Mode | Provider Route | 契约锚点 | 官方依据 |
| --- | --- | --- | --- | --- |
| Midjourney v8.1 | text-to-image | `youchuan/text-to-image-v81` | `quality` 是字符串；另含 `chaos`、`stylize`、`raw`、`iw`、`sw`、`sv`、`hd` | [454760438](https://www.runninghub.cn/runninghub-api-doc-cn/api-454760438) |
| Gemini 3.0 Pro Image | image-to-image | `rhart-image-n-pro/edit` | `imageUrls[]`、`prompt`、`aspectRatio`、`resolution` | [448183220](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183220) |
| GPT Image 2 | image-to-image | `rhart-image-g-2/image-to-image` | `imageUrls[]`、`prompt`、`aspectRatio`、`resolution` | [448183227](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183227) |
| Gemini 3.1 Flash Image | image-to-image | `rhart-image-n-g31-flash/image-to-image` | `imageUrls[]`、`prompt`、`aspectRatio`、`resolution` | [448183223](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183223) |
| Gemini 3.1 Flash Image | text-to-image | `rhart-image-n-g31-flash/text-to-image` | `prompt`、`aspectRatio`、`resolution` | [448183261](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183261) |
| GPT Image 2 | text-to-image | `rhart-image-g-2/text-to-image` | `prompt`、`aspectRatio`、`resolution` | [448183264](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183264) |

## 普通视频 Route（10）

| Product Model | Generation Mode | Provider Route | 契约锚点 | 官方依据 |
| --- | --- | --- | --- | --- |
| Veo 3.1 Fast | image-to-video | `rhart-video-v3.1-fast/image-to-video` | `imageUrls[]`；`duration` 是字符串；`aspectRatio`、`resolution` | [448183087](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183087) |
| Veo 3.1 Fast | first-last-frame | `rhart-video-v3.1-fast/start-end-to-video` | `firstFrameUrl`、`lastFrameUrl`；`duration` 是字符串 | [448183086](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183086) |
| Grok Imagine Video | image-to-video | `rhart-video-g/image-to-video` | `imageUrls[]`；`duration` 是数字；`aspectRatio`、`resolution` | [448183102](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183102) |
| Seedance 2.0 | image-to-video / first-last-frame | `rhart-video/sparkvideo-2.0/image-to-video` | `firstFrameUrl`、可选 `lastFrameUrl`；`duration` 是字符串；`ratio` 而非 `aspectRatio`；另含 `generateAudio`、`realPersonMode`、`conversionSlots`、`returnLastFrame`、`seed` | [448183116](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183116) |
| Seedance 2.0 Fast | image-to-video / first-last-frame | `rhart-video/sparkvideo-2.0-fast/image-to-video` | 与 Seedance 2.0 图生视频同形，但属于独立 Route | [448183115](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183115) |
| Seedance 2.0 | multimodal-reference | `rhart-video/sparkvideo-2.0/multimodal-video` | `imageUrls[]` 最多 9、`videoUrls[]` 最多 3、`audioUrls[]` 最多 3；提示词内媒体编号必须与数组顺序一致 | [448183127](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183127) |
| Grok Imagine Video | multimodal-reference | `rhart-video-g-official/reference-to-video` | `imageUrls[]` 1–7 张；`prompt`、`duration`、`resolution` | [448183126](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183126) |
| Grok Imagine Video | text-to-video | `rhart-video-g/text-to-video` | `duration` 是数字；`prompt`、`aspectRatio`、`resolution` | [448183149](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183149) |
| Veo 3.1 Fast | text-to-video | `rhart-video-v3.1-fast/text-to-video` | `duration` 是字符串；`prompt`、`aspectRatio`、`resolution` | [448183144](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183144) |
| Seedance 2.0 | text-to-video | `rhart-video/sparkvideo-2.0/text-to-video` | `duration` 是字符串；`ratio` 而非 `aspectRatio`；另含 `generateAudio`、`webSearch`、`returnLastFrame`、`seed` | [448183167](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183167) |

## 共用基础设施

| 用途 | Endpoint | 规则 | 官方依据 |
| --- | --- | --- | --- |
| 查询任务 | `POST /openapi/v2/query` | 使用 `taskId` 查询状态和结果；不再新接旧 status/outputs 双接口 | [425767306](https://www.runninghub.cn/runninghub-api-doc-cn/api-425767306) |
| 价格预估 | `POST /openapi/v2/price-preview/**` | `**` 与最终 Route endpoint 对齐，请求体必须复用最终 Provider Request | [454850620](https://www.runninghub.cn/runninghub-api-doc-cn/api-454850620) |

## 第一阶段明确排除

- Grok 视频编辑 [448183169](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183169)、即梦动作模仿 [448183178](https://www.runninghub.cn/runninghub-api-doc-cn/api-448183178)、Suno single/custom [448969286](https://www.runninghub.cn/runninghub-api-doc-cn/api-448969286) / [448969287](https://www.runninghub.cn/runninghub-api-doc-cn/api-448969287)：分别作为视频编辑、动作迁移和音乐 Runtime Capability 后续设计。
- 旧 status [425749003](https://www.runninghub.cn/runninghub-api-doc-cn/api-425749003) 与 outputs [425749004](https://www.runninghub.cn/runninghub-api-doc-cn/api-425749004)：不用于新的模型 API 主链路。
- webhook 查询与重发 [425749005](https://www.runninghub.cn/runninghub-api-doc-cn/api-425749005) / [425749006](https://www.runninghub.cn/runninghub-api-doc-cn/api-425749006)：属于服务端运维能力，不放入当前浏览器直连生成闭环。

## 放行条件

一条 Route 只有在 Product Model 身份、Generation Mode、完整 Route Capability Schema、官方依据和 Route Contract Test 全部就绪，并由用户确认 Product Route Binding 后，才能从 `Discovered Route` 进入 `Verified Route`。第一阶段真实验收按 Generation Mode 选择最低成本代表 Route，并在每次可能计费的 Provider Smoke Test 前单独取得用户批准。
