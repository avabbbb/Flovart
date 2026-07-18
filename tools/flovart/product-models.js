export const PRODUCT_MODEL_ENTRIES = [
  { id: 'flovart:gpt-image-2', name: 'GPT Image 2', shortName: 'GPT', company: 'OpenAI', capability: 'image', provider: 'openai', officialModelIds: ['gpt-image-2'], aliases: ['gpt-image-2-2026-04-21'], status: 'available', badge: '文字精准', description: '高质量图片生成与编辑' },
  { id: 'flovart:gemini-3-pro-image', name: 'Gemini 3 Pro Image', shortName: 'NB Pro', company: 'Google', capability: 'image', provider: 'google', officialModelIds: ['gemini-3-pro-image'], aliases: [], status: 'available', badge: '设计推理', description: 'Nano Banana Pro，适合专业设计资产' },
  { id: 'flovart:gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image', shortName: 'NB 2', company: 'Google', capability: 'image', provider: 'google', officialModelIds: ['gemini-3.1-flash-image'], aliases: ['gemini-3.1-flash-image-preview'], status: 'available', badge: '通用', description: 'Nano Banana 2，设计与速度平衡，最多 14 张参考图' },
  { id: 'flovart:gemini-3.1-flash-lite-image', name: 'Gemini 3.1 Flash-Lite Image', shortName: 'NB 2 Lite', company: 'Google', capability: 'image', provider: 'google', officialModelIds: ['gemini-3.1-flash-lite-image'], aliases: [], status: 'available', badge: '极速', description: 'Nano Banana 2 Lite，亚秒延迟，推荐替代 NB 1' },
  { id: 'flovart:imagen-4', name: 'Imagen 4', shortName: 'Imagen 4', company: 'Google', capability: 'image', provider: 'google', officialModelIds: ['imagen-4.0-generate-001'], aliases: ['imagen-4.0-fast-generate-001', 'imagen-4.0-ultra-generate-001'], status: 'available', badge: '已弃用', description: 'Imagen 4，2026-08-17 关停，建议迁移到 Nano Banana 2 Lite' },
  { id: 'flovart:seedream-5-pro', name: 'Seedream 5.0 Pro', shortName: 'S5 Pro', company: 'ByteDance', capability: 'image', provider: 'volcengine', officialModelIds: [], aliases: ['seedream-5.0-pro', 'doubao-seedream-5.0-pro'], status: 'mapping-required', badge: '待映射', description: '官方产品已发布，API 模型 ID 由用户映射' },
  { id: 'flovart:midjourney-v8-1', name: 'Midjourney v8.1', shortName: 'MJ', company: 'Midjourney', capability: 'image', provider: 'midjourney', officialModelIds: [], aliases: ['midjourney-v8.1', 'youchuan-text-to-image-v81'], status: 'mapping-required', badge: '艺术风格', description: '艺术风格文生图，通过 RunningHub 悠船渠道调用' },
  { id: 'flovart:seedance-2', name: 'Seedance 2.0', shortName: 'S2', company: 'ByteDance', capability: 'video', provider: 'volcengine', officialModelIds: ['doubao-seedance-2-0-260128'], aliases: ['dreamina-seedance-2-0-260128', 'doubao-seedance-2.0', 'seedance-2.0'], status: 'available', badge: '多模态', description: '图文音视频统一参考，任务提交后不自动切线' },
  { id: 'flovart:seedance-2-fast', name: 'Seedance 2.0 Fast', shortName: 'S2 Fast', company: 'ByteDance', capability: 'video', provider: 'volcengine', officialModelIds: ['doubao-seedance-2-0-fast-260128'], aliases: [], status: 'available', badge: '快速', description: '快速版本，独立能力与价格线路' },
  { id: 'flovart:veo-3.1', name: 'Veo 3.1', shortName: 'Veo', company: 'Google', capability: 'video', provider: 'google', officialModelIds: ['veo-3.1-generate-preview'], aliases: [], status: 'available', badge: '电影感', description: '支持首尾帧与最多 3 张参考图' },
  { id: 'flovart:veo-3.1-fast', name: 'Veo 3.1 Fast', shortName: 'Veo Fast', company: 'Google', capability: 'video', provider: 'google', officialModelIds: ['veo-3.1-fast-generate-preview'], aliases: [], status: 'available', badge: '快速', description: '更快的 Veo 3.1 线路' },
  { id: 'flovart:veo-3.1-lite', name: 'Veo 3.1 Lite', shortName: 'Veo Lite', company: 'Google', capability: 'video', provider: 'google', officialModelIds: ['veo-3.1-lite-generate-preview'], aliases: [], status: 'available', badge: '经济', description: '轻量线路，不显示 4K 与参考图模式' },
  { id: 'flovart:kling-video-3', name: 'Kling VIDEO 3.0', shortName: 'Kling 3', company: 'Kuaishou', capability: 'video', provider: 'keling', officialModelIds: [], aliases: ['kling-video-3.0', 'kling-v3'], status: 'mapping-required', badge: '待映射', description: '公开产品能力已确认，API ID 由用户映射' },
  { id: 'flovart:kling-video-3-omni', name: 'Kling VIDEO 3.0 Omni', shortName: 'Kling Omni', company: 'Kuaishou', capability: 'video', provider: 'keling', officialModelIds: [], aliases: ['kling-video-3.0-omni', 'kling-v3-omni'], status: 'mapping-required', badge: '全能参考', description: '多模态参考与多镜头版本' },
  { id: 'flovart:grok-imagine-video', name: 'Grok Imagine Video', shortName: 'Grok', company: 'xAI', capability: 'video', provider: 'xai', officialModelIds: ['grok-imagine-video'], aliases: ['grok-imagine'], status: 'available', badge: '视频扩展', description: 'xAI 视频生成，支持文生、图生与视频扩展' },
  { id: 'flovart:grok-imagine-video-1.5', name: 'Grok Imagine Video 1.5', shortName: 'Grok 1.5', company: 'xAI', capability: 'video', provider: 'xai', officialModelIds: ['grok-imagine-video-1.5'], aliases: ['grok-imagine-1.5'], status: 'available', badge: '升级版', description: 'xAI 1.5 线路视频生成，更长时长与更高清晰度' },
];

export function listProductModelEntries(capability) {
  if (!capability || capability === 'all') return PRODUCT_MODEL_ENTRIES;
  return PRODUCT_MODEL_ENTRIES.filter(model => model.capability === capability);
}

export function findProductModelEntry(id) {
  return PRODUCT_MODEL_ENTRIES.find(model => model.id === id);
}
