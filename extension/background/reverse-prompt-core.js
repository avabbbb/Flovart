// 图片反推（Reverse Prompt）的纯逻辑：系统指令、三种线格式的请求体与端点、响应解析。
// 不发网络、不读 Key、不记用量。网页 services/aiGateway.ts 与插件 Service Worker 共用这一份；
// 插件构建只拷贝文件、不打包，所以写成无依赖的 ESM JS（tsconfig 开了 allowJs）。
//
// format：'google'（generateContent）| 'anthropic'（messages）| 'openai'（chat/completions，含各兼容接口）

export const REVERSE_PROMPT_DEFAULT_TEMPERATURE = 0.2;
export const REVERSE_PROMPT_MAX_TOKENS = 1024;

/**
 * 根据 UI 语言 + 图片尺寸生成系统指令，输出跟随用户语言。
 * @param {'en' | 'zho'} lang
 * @param {{ width?: number; height?: number }} [meta]
 * @returns {string}
 */
export function buildReversePromptInstruction(lang, meta) {
  const width = meta?.width;
  const height = meta?.height;
  const ratio = width && height ? (width / height).toFixed(2) : '';
  const size = width + '×' + height;
  const metaHint = ratio
    ? (lang === 'zho'
      ? '\n图片尺寸 ' + size + '，宽高比约 ' + ratio + '。请将宽高比信息融入描述。'
      : '\nImage dimensions ' + size + ', aspect ratio ~' + ratio + '. Incorporate aspect ratio context.')
    : '';
  if (lang === 'zho') {
    return [
      '你是一名顶级 AI 图像提示词工程师。',
      '分析给定图片，生成一段可用于 AI 图像生成器直接重现该图的详细提示词。',
      '包含：主体、构图、拍摄角度、光线、色彩、情绪、艺术风格、媒介及精细细节。',
      '如果画面中有明显应避免的元素（如水印、模糊、畸变），在末尾用「负面提示：」列出。',
      '仅输出提示词文本，使用中文，不加解释、不加 markdown、不加前缀。',
      metaHint,
    ].filter(Boolean).join('\n');
  }
  return [
    'You are an expert AI image prompt engineer.',
    'Analyze the given image and generate a detailed prompt that could recreate it with an AI image generator.',
    'Include: subject, composition, camera angle, lighting, color palette, mood, artistic style, medium, and fine details.',
    'If there are obvious elements to avoid (e.g. watermarks, blur, distortion), append them at the end after "Negative prompt:".',
    'Output ONLY the prompt text. No explanations, no markdown, no prefix.',
    metaHint,
  ].filter(Boolean).join('\n');
}

/** data:URL 去掉前缀只留 base64；不是 data:URL 则原样返回。 */
export function dataUrlPayload(dataUrl) {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * @param {'google' | 'anthropic' | 'openai'} format
 * @param {string} baseUrl 已规范化、不带末尾斜杠
 * @param {string} [model] google 格式必填
 * @returns {string}
 */
export function reversePromptEndpoint(format, baseUrl, model) {
  if (format === 'google') return baseUrl + '/models/' + encodeURIComponent(model || '') + ':generateContent';
  if (format === 'anthropic') return baseUrl + '/messages';
  return baseUrl + '/chat/completions';
}

/**
 * @param {'google' | 'anthropic' | 'openai'} format
 * @param {{ model: string; instruction: string; imageDataUrl: string; mimeType?: string; temperature?: number; maxTokens?: number }} input
 * @returns {Record<string, unknown>}
 */
export function buildReversePromptBody(format, input) {
  const temperature = input.temperature ?? REVERSE_PROMPT_DEFAULT_TEMPERATURE;
  const maxTokens = input.maxTokens ?? REVERSE_PROMPT_MAX_TOKENS;
  if (format === 'google') {
    return {
      contents: [{
        parts: [
          { text: input.instruction },
          { inlineData: { mimeType: input.mimeType, data: dataUrlPayload(input.imageDataUrl) } },
        ],
      }],
      generationConfig: { temperature },
    };
  }
  if (format === 'anthropic') {
    return {
      model: input.model,
      max_tokens: maxTokens,
      temperature,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: input.instruction },
          { type: 'image', source: { type: 'base64', media_type: input.mimeType || 'image/png', data: dataUrlPayload(input.imageDataUrl) } },
        ],
      }],
    };
  }
  return {
    model: input.model,
    max_tokens: maxTokens,
    temperature,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: input.instruction },
        { type: 'image_url', image_url: { url: input.imageDataUrl } },
      ],
    }],
  };
}

/**
 * @param {'google' | 'anthropic' | 'openai'} format
 * @param {unknown} json
 * @returns {string}
 */
export function parseReversePromptResponse(format, json) {
  if (!json || typeof json !== 'object') return '';
  if (format === 'google') {
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof text === 'string' ? text.trim() : '';
  }
  if (format === 'anthropic') {
    const blocks = Array.isArray(json.content) ? json.content : [];
    return blocks.map(block => (block && typeof block.text === 'string' ? block.text : '')).join('\n').trim();
  }
  const content = json.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}
