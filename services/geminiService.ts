/**
 * ============================================
 * Gemini AI 服务 (Gemini Service)
 * ============================================
 * 
 * 【模块职责】
 * 封装 Google Gemini API 调用，提供 AI 图像生成和编辑功能
 * 
 * 【核心功能】
 * 1. editImage: 编辑现有图片（支持局部重绘/inpainting）
 * 2. generateImageFromText: 文本生成图片
 * 3. generateVideo: 图片生成视频（基于 Veo 2.0）
 * 
 * 【使用的 AI 模型】
 * - gemini-3-flash-preview: 文本理解与提示词润色
 * - gemini-3.1-flash-image-preview: 图像编辑和生成
 * - imagen-4.0-generate-001: 文本直接生成图像
 * - veo-3.1-generate-preview: 视频生成
 * 
 * 【API Key 配置】
 * 从环境变量 process.env.API_KEY 读取 Gemini API Key
 * 需要在 .env.local 文件中配置：GEMINI_API_KEY=your_key
 * 
 * 【错误处理】
 * - API 调用失败会抛出详细错误信息
 * - 响应异常会有友好的提示消息
 * - 视频生成失败会中断操作并提示原因
 */

import { GoogleGenAI, Modality, GenerateContentResponse, GenerateVideosOperation } from "@google/genai";
import type { PromptEnhanceRequest, PromptEnhanceResult } from "../types";

// 从用户配置或 runtime config 获取 API Key（不在 bundle 中硬编码任何密钥）
const API_KEY: string | undefined = undefined;
let runtimeConfig: {
  textApiKey?: string;
  imageApiKey?: string;
  videoApiKey?: string;
  textModel?: string;
  imageModel?: string;
  textToImageModel?: string;
  videoModel?: string;
  baseUrl?: string;
} = {};

export function setGeminiRuntimeConfig(config: {
  textApiKey?: string;
  imageApiKey?: string;
  videoApiKey?: string;
  textModel?: string;
  imageModel?: string;
  textToImageModel?: string;
  videoModel?: string;
  baseUrl?: string;
}) {
  runtimeConfig = { ...runtimeConfig, ...config };
}

/**
 * 【函数】获取 API Key
 *
 * 按优先级解析可用的 API Key：
 *   1. explicitKey（函数参数显式传入，来自 aiGateway 路由）
 *   2. runtimeConfig 中对应 capability 的 key
 *   3. runtimeConfig 中其他 capability 的 key（回退链）
 *   4. 环境变量 process.env.API_KEY（.env 文件配置）
 *
 * @param capability - 使用场景：text（LLM 润色）、image（图片生成/编辑）、video（视频生成）
 * @param explicitKey - 可选的显式 API Key，优先级最高
 */
function getApiKey(capability: "text" | "image" | "video" = "text", explicitKey?: string): string {
  if (explicitKey) return explicitKey;
  const scopedKey =
    capability === "text"
      ? runtimeConfig.textApiKey
      : capability === "image"
        ? runtimeConfig.imageApiKey
        : runtimeConfig.videoApiKey;
  const key = scopedKey || runtimeConfig.textApiKey || runtimeConfig.imageApiKey || runtimeConfig.videoApiKey || API_KEY;
  if (!key) {
    throw new Error(
      "Gemini API key is not configured. " +
      "Please add your Google API key in Settings → API Keys (recommended), " +
      "or set GEMINI_API_KEY in a .env.local file and restart the dev server."
    );
  }
  return key;
}

/** 获取 Gemini REST API 的基础地址（供 aiGateway 内直接发 fetch 时使用） */
export function getGeminiRestBaseUrl(): string {
  return (runtimeConfig.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
}

/**
 * 【函数】创建 Google GenAI 客户端实例
 * @param capability - 使用场景
 * @param explicitKey - 可选的显式 API Key
 */
function getClient(capability: "text" | "image" | "video" = "text", explicitKey?: string) {
  const base = runtimeConfig.baseUrl?.replace(/\/+$/, '');
  return new GoogleGenAI({
    apiKey: getApiKey(capability, explicitKey),
    ...(base ? { httpOptions: { baseUrl: base } } : {}),
  });
}

function normalizeGeminiErrorMessage(message: string, status?: number): string {
  const msg = message || '';

  if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
    return 'API Key 无效，请检查 Google AI Studio 里复制的 Key 是否正确。';
  }

  if (msg.includes('PERMISSION_DENIED') || msg.includes('403')) {
    return 'Google Key 权限不足。请确认该 Key 对应的 AI Studio 项目可用，并已启用 Gemini API 访问。';
  }

  if (
    status === 429 ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('no available credits') ||
    msg.includes('billing') ||
    msg.includes('credit')
  ) {
    return 'Google AI Studio 当前不可计费或额度不足。请检查：1. 是否仍是免费层配额打满；2. AI Studio 项目是否已设置结算；3. 2026 年起 Google Cloud 300 美元欢迎赠金通常不能直接用于 Gemini API；4. 若你的账号是预付费方案，AI Studio 结算页里必须有正的预付积分。';
  }

  return msg;
}

/**
 * 轻量级 API Key 验证 — 调用 Gemini models.list 接口
 * 成功返回 { ok: true }，失败返回 { ok: false, message }
 */
export async function validateGeminiApiKey(apiKey: string, baseUrl?: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const base = (baseUrl || runtimeConfig.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    const url = `${base}/models?key=${encodeURIComponent(apiKey)}&pageSize=1`;
    const res = await fetch(url);
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    const msg = body?.error?.message || `HTTP ${res.status}`;
    return { ok: false, message: normalizeGeminiErrorMessage(msg, res.status) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}

function getTextFromResponse(response: GenerateContentResponse): string {
  if (!response.candidates || response.candidates.length === 0) return "";
  const parts = response.candidates[0]?.content?.parts ?? [];
  return parts
    .map(part => part.text || "")
    .join("\n")
    .trim();
}

function safeParseEnhanceJson(raw: string, fallbackPrompt: string): PromptEnhanceResult {
  const defaultResult: PromptEnhanceResult = {
    enhancedPrompt: fallbackPrompt,
    negativePrompt: "",
    suggestions: [],
    notes: raw || "No response content returned by model.",
  };
  if (!raw) return defaultResult;

  const clean = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(clean) as Partial<PromptEnhanceResult>;
    return {
      enhancedPrompt: parsed.enhancedPrompt?.trim() || fallbackPrompt,
      negativePrompt: parsed.negativePrompt?.trim() || "",
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter(Boolean).slice(0, 8) : [],
      notes: parsed.notes?.trim() || "",
    };
  } catch {
    return defaultResult;
  }
}

export async function enhancePromptWithGemini(request: PromptEnhanceRequest, apiKey?: string): Promise<PromptEnhanceResult> {
  const modeHintMap: Record<PromptEnhanceRequest["mode"], string> = {
    smart: "Do intelligent enhancement with richer cinematic details, composition, and lighting.",
    style: `Rewrite with strong style intent. Preferred style preset: ${request.stylePreset || "cinematic"}.`,
    precise: "Preserve user intent strictly; only optimize clarity and structure.",
    translate: "Translate and optimize prompt for model friendliness while preserving semantics.",
  };

  const instruction = [
    "You are a professional prompt engineer for image/video generation.",
    "Return ONLY valid JSON with keys: enhancedPrompt, negativePrompt, suggestions, notes.",
    "Keep enhancedPrompt concise but vivid, no markdown.",
    "negativePrompt should be a comma-separated phrase list.",
    "suggestions should be short keyword phrases.",
    modeHintMap[request.mode],
  ].join("\n");

  try {
    const ai = getClient("text", apiKey);
    const model = runtimeConfig.textModel || "gemini-3-flash-preview";
    const response: GenerateContentResponse = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            text: `${instruction}\n\nUser prompt:\n${request.prompt}`,
          },
        ],
      },
    });

    const raw = getTextFromResponse(response);
    return safeParseEnhanceJson(raw, request.prompt);
  } catch (error) {
    console.error("Error enhancing prompt with Gemini:", error);
    if (error instanceof Error) {
      throw new Error(`提示词润色失败: ${normalizeGeminiErrorMessage(error.message)}`);
    }
    throw new Error("润色提示词时发生未知错误。");
  }
}

/**
 * 【类型定义】图像输入格式
 */
type ImageInput = {
    href: string;        // 图像的 Data URL (base64)
    mimeType: string;    // 图像MIME类型，如 image/png
};

/**
 * 【函数】编辑图像 / AI 改图
 * 
 * 使用 Gemini 2.5 Flash 模型编辑图片，支持局部重绘（inpainting）
 * 
 * @param {ImageInput[]} images - 输入的图片数组（通常是一张，支持多张）
 * @param {string} prompt - AI 编辑提示词，描述想要的改动
 * @param {ImageInput} [mask] - 可选的遮罩图片，用于局部重绘（白色区域会被重绘）
 * @returns {Promise} 返回新生成的图片和可能的文本响应
 * 
 * 【使用场景】
 * 1. 全图编辑：传入图片+提示词，AI 修改整张图
 * 2. 局部重绘：传入图片+提示词+遮罩，AI 只修改遮罩区域
 * 3. 风格转换：改变图片风格、色调、氛围
 * 4. 内容添加：在图片中添加新元素
 * 
 * 【实现逻辑】
 * 1. 将输入图片转换为 Gemini API 需要的格式
 * 2. 处理可选的遮罩图片
 * 3. 组装请求内容（顺序很重要：提示词->图片->遮罩）
 * 4. 调用 Gemini API 生成新图片
 * 5. 解析响应，提取图片数据和文本
 * 6. 返回结果或错误信息
 * 
 * 【数据格式处理】
 * - 输入的 href 是 Data URL 格式：data:image/png;base64,xxxxx
 * - 需要提取 base64 部分（去掉前缀）发送给 API
 */
export async function editImage(
  images: ImageInput[], 
  prompt: string,
  mask?: ImageInput,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null; }> {
  
  // 步骤1：转换图片格式 - 提取 base64 数据
  const imageParts = images.map(image => {
    const dataUrlParts = image.href.split(',');
    const base64Data = dataUrlParts.length > 1 ? dataUrlParts[1] : dataUrlParts[0];
    return {
      inlineData: {
        data: base64Data,
        mimeType: image.mimeType,
      },
    };
  });

  // 步骤2：处理遮罩图片（如果有）
  const maskPart = mask ? {
    inlineData: {
      data: mask.href.split(',')[1],  // 提取 base64 部分
      mimeType: mask.mimeType,
    },
  } : null;

  // 步骤3：准备提示词
  const textPart = { text: prompt };

  // 步骤4：组装请求内容
  // 重要：API 要求特定顺序 - 局部重绘时必须是：提示词->图片->遮罩
  // 这样才能正确应用遮罩进行局部修改
  const parts = maskPart
    ? [textPart, ...imageParts, maskPart]  // 有遮罩：提示词+图片+遮罩
    : [...imageParts, textPart];            // 无遮罩：图片+提示词

  try {
    const ai = getClient("image", apiKey);
    // 步骤5：调用 Gemini API
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: runtimeConfig.imageModel || 'gemini-3.1-flash-image-preview',  // 使用 Gemini 3.1 Flash 图像模型
      contents: {
        parts: parts,  // 传入组装好的内容
      },
      config: {
        abortSignal: signal,
        responseModalities: [Modality.IMAGE, Modality.TEXT],  // 请求返回图片和文本
      },
    });

    // 步骤6：初始化返回值
    let newImageBase64: string | null = null;
    let newImageMimeType: string | null = null;
    let textResponse: string | null = null;

    // 步骤7：解析 API 响应
    if (response.candidates && response.candidates.length > 0 && response.candidates[0].content) {
      const parts = response.candidates[0].content.parts;
      // 遍历响应中的所有部分，提取图片和文本
      for (const part of parts) {
        if (part.inlineData) {
          // 提取图片数据
          newImageBase64 = part.inlineData.data;
          newImageMimeType = part.inlineData.mimeType;
        } else if (part.text) {
          // 提取文本响应
          textResponse = part.text;
        }
      }
    } else {
        // 响应被阻止或无内容（可能因为安全策略）
        textResponse = "The AI response was blocked or did not contain content.";
        if (response.candidates && response.candidates.length > 0 && response.candidates[0].finishReason) {
            textResponse += ` (Reason: ${response.candidates[0].finishReason})`;
        }
    }
    
    // 步骤8：验证是否生成了图片
    if (!newImageBase64) {
        console.warn("API response did not contain an image part.", response);
        textResponse = textResponse || "The AI did not generate a new image. Please try a different prompt.";
    }

    return { newImageBase64, newImageMimeType, textResponse };
    
  } catch (error) {
    // 步骤9：错误处理
    console.error("Error calling Gemini API:", error);
    if (error instanceof Error) {
      throw new Error(`Gemini API 错误: ${normalizeGeminiErrorMessage(error.message)}`);
    }
    throw new Error("调用 Gemini API 时发生未知错误。");
  }
}

/**
 * 【函数】文本生成图像 / AI 绘画
 * 
 * 使用 Imagen 4.0 模型直接从文本描述生成图片
 * 
 * @param {string} prompt - 图片描述提示词
 * @returns {Promise} 返回生成的图片数据
 * 
 * 【使用场景】
 * - 从零开始创作图片
 * - 快速生成概念图
 * - 为灵感库添加新素材
 * 
 * 【实现逻辑】
 * 1. 调用 Imagen 4.0 API
 * 2. 传入提示词和配置（生成1张PNG图片）
 * 3. 解析响应，提取图片数据
 * 4. 返回 base64 格式的图片
 * 
 * 【注意事项】
 * - 使用专门的文本生成图片模型，质量更高
 * - 不需要输入图片，纯文本生成
 * - 生成速度较快
 */
export async function generateImageFromText(prompt: string, apiKey?: string, signal?: AbortSignal): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null; }> {
  try {
    const ai = getClient("image", apiKey);
    const response = await ai.models.generateImages({
        model: runtimeConfig.textToImageModel || 'imagen-4.0-generate-001',  // 使用 Imagen 4.0 模型
        prompt: prompt,
        config: {
          abortSignal: signal,
          numberOfImages: 1,              // 生成1张图片
          outputMimeType: 'image/png',    // PNG 格式
        },
    });

    if (response.generatedImages && response.generatedImages.length > 0) {
      const image = response.generatedImages[0];
      return {
        newImageBase64: image.image.imageBytes,
        newImageMimeType: 'image/png',
        textResponse: null
      };
    } else {
      return {
        newImageBase64: null,
        newImageMimeType: null,
        textResponse: "The AI did not generate an image. Please try a different prompt."
      };
    }
  } catch (error) {
    console.error("Error calling Gemini API for text-to-image:", error);
    if (error instanceof Error) {
      throw new Error(`Gemini 图片生成错误: ${normalizeGeminiErrorMessage(error.message)}`);
    }
    throw new Error("调用 Gemini API 生成图片时发生未知错误。");
  }
}

/**
 * 【函数】生成视频 / AI 视频生成
 * 
 * 使用 Veo 3.1 模型从图片生成视频，支持纯文本或图片+文本模式
 * 
 * @param {string} prompt - 视频描述提示词
 * @param {'16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9'} aspectRatio - 视频宽高比
 * @param {Function} onProgress - 进度回调函数，用于显示生成状态
 * @param {ImageInput} [image] - 可选的参考图片，用于图生视频
 * @returns {Promise} 返回视频 Blob 和 MIME 类型
 * 
 * 【使用场景】
 * 1. 图生视频：将静态图片转为动态视频
 * 2. 文生视频：纯文本描述生成视频
 * 3. 分镜预览：为分镜图生成动态效果
 * 4. 创意展示：快速生成视频小样
 * 
 * 【实现逻辑】
 * 1. 初始化视频生成任务
 * 2. 提交请求到 Veo 2.0 API
 * 3. 轮询检查生成进度（每10秒）
 * 4. 显示友好的进度提示
 * 5. 生成完成后下载视频文件
 * 6. 返回视频 Blob 对象
 * 
 * 【注意事项】
 * - 视频生成耗时较长（通常几分钟）
 * - 需要轮询检查状态
 * - 使用进度回调保持用户体验
 * - 支持16:9和9:16两种宽高比
 */
export async function generateVideo(
  prompt: string,
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9',
  onProgress: (message: string) => void,
  image?: ImageInput,
  apiKey?: string
): Promise<{ videoBlob: Blob; mimeType: string }> {
  const ai = getClient("video", apiKey);
  // 步骤1：初始化
  onProgress('Initializing video generation...');
  
  // 步骤2：处理输入图片（如果有）
  const imagePart = image ? {
    imageBytes: image.href.split(',')[1],  // 提取 base64 数据
    mimeType: image.mimeType,
  } : undefined;

  // 步骤3：提交视频生成请求
  let operation: GenerateVideosOperation = await ai.models.generateVideos({
    model: runtimeConfig.videoModel || 'veo-3.1-generate-preview',  // 使用 Veo 3.1 模型
    prompt: prompt,
    image: imagePart,
    config: {
      numberOfVideos: 1,
      aspectRatio: aspectRatio,
    }
  });
  
  // 步骤4：准备进度提示消息
  const progressMessages = [
      'Rendering frames...',
      'Compositing video...',
      'Applying final touches...',
      'Almost there...',
  ];
  let messageIndex = 0;

  onProgress('Generation started, this may take a few minutes.');

  // 步骤5：轮询检查生成状态
  while (!operation.done) {
    onProgress(progressMessages[messageIndex % progressMessages.length]);
    messageIndex++;
    await new Promise(resolve => setTimeout(resolve, 10000));  // 每10秒检查一次
    operation = await ai.operations.getVideosOperation({operation: operation});
  }

  // 步骤6：检查是否有错误
  if (operation.error) {
    throw new Error(`Video generation failed: ${operation.error.message}`);
  }

  // 步骤7：获取视频下载链接
  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) {
    throw new Error("Video generation completed, but no download link was found.");
  }

  // 步骤8：下载视频文件（使用 Authorization header 防止 API Key 泄露到 URL）
  onProgress('Downloading generated video...');
  const videoApiKey = getApiKey("video", apiKey);
  const response = await fetch(downloadLink, {
    headers: { 'x-goog-api-key': videoApiKey },
  });
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
  }

  // 步骤9：转换为 Blob 对象
  const videoBlob = await response.blob();
  const mimeType = response.headers.get('Content-Type') || 'video/mp4';

  return { videoBlob, mimeType };
}
