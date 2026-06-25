# 将 RunningHub 标准模型作为原生 Provider 接入

RunningHub 标准模型使用 Provider 自己定义的字段名和任务结果格式，所以 Flovart 将它作为原生 Provider 处理，而不是伪装成 OpenAI Compatible。

这样做可以让 OpenAI 兼容接口继续保持简单路径，同时把 RunningHub 的模型路径、Prompt 字段和默认载荷显式保存在 Provider 配置里。普通 G/V/视频标准模型默认使用 `prompt` 字段，F 系列 Comfy 派生模型才使用 `12##text` 这类节点字段。

当前内置推荐模型来自用户提供的 6 个 RunningHub 标准模型详情页：全能图片 G-2.0 图生图、全能图片 V2 图生图、全能视频 V3.1 fast 图生视频、全能视频 V3.1 fast 首尾帧、seedance2.0 多模态视频和 seedance2.0 图生视频。

字段映射规则保持显式：

- 普通图生图使用 `prompt`、`imageUrls`、`aspectRatio`、`resolution`。
- V3.1 fast 图生视频使用 `prompt`、`imageUrls`、`aspectRatio`、`duration`、`resolution`。
- V3.1 fast 首尾帧使用 `prompt`、`firstFrameUrl`、`lastFrameUrl`、`aspectRatio`、`duration`、`resolution`。
- seedance2.0 图生视频使用 `prompt`、`firstFrameUrl`、`lastFrameUrl`、`ratio`、`duration`、`resolution`。
- seedance2.0 多模态视频使用 `prompt`、`imageUrls`、`videoUrls`、`audioUrls`、`ratio`、`duration`、`resolution`。
