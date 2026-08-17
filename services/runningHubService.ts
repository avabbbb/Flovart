/**
 * RunningHub API Service
 * Docs: https://www.runninghub.cn/ (ComfyUI-based API)
 */

import { resolveRouteIdByDocId } from './runningHubRouteCatalog';

const RH_BASE = 'https://www.runninghub.cn/openapi/v2';
const POLL_INTERVAL = 5000; // 5s
const MAX_POLL_ATTEMPTS = 120; // 10 minutes max

const RUNNINGHUB_DETAIL_ENDPOINTS: Record<string, string> = {
  '2046503667076751361': 'rhart-image-g-2/image-to-image',
  '2027196343409463297': 'rhart-image-n-g31-flash/image-to-image',
  '2034917373414539277': 'rhart-video/sparkvideo-2.0/multimodal-video',
};

// RunningHub 标准模型包：只内置当前项目实际使用的官方详情页端点。
// 这些端点使用 /openapi/v2/<endpoint> + Bearer 认证。

// ── 展示名归一化：去掉版本与渠道标记，只保留「家族 + 模式」（如「可灵 o3-pro 文生视频」→「可灵 文生视频」）。
// 列表展示用；提交仍用 endpoint id，不受影响。官方出新版本时展示名自动合并，无需更新。
const RUNNINGHUB_VERSION_RE = /\b(?:o\d+(?:-[a-z0-9]+)?|v?\d+\.\d+(?:-[a-z0-9.]+)?|v\d+(?:\.\d+)?|q\d+(?:-[a-z0-9]+)?|-[a-z]{1,2}\d+(?:\.\d+)?)\b/gi;
const RUNNINGHUB_CHANNEL_RE = /\s*(?:官方稳定版|低价渠道版|低价通道|通道版|已下架|标准版|基础版|编辑版|预览版)\s*/g;
const RUNNINGHUB_TIER_RE = /\s*(?:fast|pro|std|lite|turbo|mini|preview|hd|ultra)\b/gi;

export function stripRunningHubVersionName(name: string): string {
  if (!name) return '';
  // 英文 endpoint 路径（含 /）不做版本清洗，原样返回，避免拆坏
  if (/^[A-Za-z0-9._/-]+\/[A-Za-z0-9._/-]+$/.test(name)) return name;
  return name
    .replace(RUNNINGHUB_CHANNEL_RE, ' ')
    .replace(RUNNINGHUB_VERSION_RE, ' ')
    .replace(RUNNINGHUB_TIER_RE, ' ')
    .replace(/[（(]?官方[^）)]*[）)]?/g, ' ')
    .replace(/-+/g, ' ')
    .replace(/[()（）]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const BUILTIN_RUNNINGHUB_MODELS: Array<{ id: string; capability: 'image' | 'video'; description: string }> = [
  { id: RUNNINGHUB_DETAIL_ENDPOINTS['2046503667076751361'], capability: 'image', description: '全能图片 G-2.0 图生图' },
  { id: RUNNINGHUB_DETAIL_ENDPOINTS['2027196343409463297'], capability: 'image', description: '全能图片 V2 图生图' },
  { id: RUNNINGHUB_DETAIL_ENDPOINTS['2034917373414539277'], capability: 'video', description: 'Seedance 2.0 多模态视频 (Sparkvideo)' },
  { id: 'rhart-image-n-pro/edit', capability: 'image', description: 'Nano Banana Pro 编辑 (低价通道)' },
  { id: 'kling-v3.0-std/text-to-video', capability: 'video', description: '可灵 v3.0 文生视频' },
  { id: 'kling-v2.5-turbo-pro/text-to-video', capability: 'video', description: '可灵 v2.5 Turbo Pro 文生视频' },
  { id: 'kling-v2.5-turbo-std/text-to-video', capability: 'video', description: '可灵 v2.5 Turbo 文生视频' },
  { id: 'kling-video-o3-std/reference-to-video', capability: 'video', description: '可灵 O3 参考生视频' },
  { id: 'kling-v3.0-std/motion-control', capability: 'video', description: '可灵 v3.0 动作控制' },
  { id: 'rhart-video/sparkvideo-2.0/text-to-video', capability: 'video', description: 'Seedance 2.0 文生视频' },
  { id: 'rhart-video/sparkvideo-2.0/image-to-video', capability: 'video', description: 'Seedance 2.0 图生视频' },
  { id: 'rhart-video/sparkvideo-2.0/multimodal-video', capability: 'video', description: 'Seedance 2.0 多模态视频' },
  { id: 'rhart-video/sparkvideo-2.0-fast/text-to-video', capability: 'video', description: 'Seedance 2.0 Fast 文生视频' },
  { id: 'rhart-video/sparkvideo-2.0-fast/image-to-video', capability: 'video', description: 'Seedance 2.0 Fast 图生视频' },
  { id: 'rhart-video/sparkvideo-2.0-fast/multimodal-video', capability: 'video', description: 'Seedance 2.0 Fast 多模态视频' },
  { id: 'vidu/text-to-video', capability: 'video', description: 'Vidu Q2 文生视频' },
  { id: 'vidu/text-to-video-q3-pro', capability: 'video', description: 'Vidu Q3 Pro 文生视频 (音画同出)' },
  { id: 'vidu/image-to-video-q3-pro', capability: 'video', description: 'Vidu Q3 Pro 图生视频' },
  { id: 'vidu/image-to-video-q2-pro', capability: 'video', description: 'Vidu Q2 Pro 图生视频' },
  { id: 'vidu/image-to-video-q2-turbo', capability: 'video', description: 'Vidu Q2 Turbo 图生视频' },
  { id: 'rhart-video/wan-2.2/image-to-video', capability: 'video', description: 'Wan 2.2 图生视频' },
  // Veo 3.1 系列（Google DeepMind 旗舰视频模型，原生音频同步 + 口型同步）
  { id: 'rhart-video-v3.1-fast/text-to-video', capability: 'video', description: '全能视频 V3.1 Fast 文生视频 (低价通道)' },
  { id: 'rhart-video-v3.1-fast-official/text-to-video', capability: 'video', description: 'Veo 3.1 Fast 文生视频 (官方稳定)' },
  { id: 'rhart-video-v3.1-fast/image-to-video', capability: 'video', description: '全能视频 V3.1 Fast 图生视频 (低价通道)' },
  { id: 'rhart-video-v3.1-fast/start-end-to-video', capability: 'video', description: '全能视频 V3.1 Fast 首尾帧生视频 (低价通道)' },
  { id: 'rhart-video-v3.1-fast-official/image-to-video', capability: 'video', description: 'Veo 3.1 Fast 图生视频 (官方稳定)' },
  { id: 'rhart-video-v3.1-pro/text-to-video', capability: 'video', description: '全能视频 V3.1 Pro 文生视频 (低价通道)' },
  { id: 'rhart-video-v3.1-pro/image-to-video', capability: 'video', description: '全能视频 V3.1 Pro 图生视频 (低价通道)' },
  { id: 'rhart-video-v3.1-pro/start-end-to-video', capability: 'video', description: '全能视频 V3.1 Pro 首尾帧生视频 (低价通道)' },
  { id: 'rhart-video-v3.1-pro-official/text-to-video', capability: 'video', description: 'Veo 3.1 Pro 文生视频 (官方稳定)' },
  { id: 'rhart-video-v3.1-pro-official/image-to-video', capability: 'video', description: 'Veo 3.1 Pro 图生视频 (官方稳定)' },
  { id: 'rhart-video-v3.1-pro-official/reference-to-video', capability: 'video', description: 'Veo 3.1 Pro 参考生视频 (官方稳定)' },
  { id: 'rhart-video-v3.1-lite-official/text-to-video', capability: 'video', description: 'Veo 3.1 Lite 文生视频 (官方稳定)' },
  { id: 'rhart-video-v3.1-lite-official/image-to-video', capability: 'video', description: 'Veo 3.1 Lite 图生视频 (官方稳定)' },
  { id: 'rhart-video-v3.1-lite-official/start-end-to-video', capability: 'video', description: 'Veo 3.1 Lite 首尾帧视频 (官方稳定)' },
  // SkyReels V4 Omni（天工 AI 统一多模态视频生成）
  { id: 'skyreels-v4/omni-reference-fast', capability: 'video', description: 'SkyReels V4 Omni 参考生视频 (fast)' },
  // 全能视频S（低价渠道版，duration 10/15s，aspectRatio 16:9/9:16）
  { id: 'rhart-video-s/text-to-video', capability: 'video', description: '全能视频S 文生视频 (低价渠道)' },
  // Veo 3.1 Fast 参考生视频（官方稳定版，1-3 张参考图，固定 8s，有 aspectRatio）
  { id: 'rhart-video-v3.1-fast-official/reference-to-video', capability: 'video', description: 'Veo 3.1 Fast 参考生视频 (官方稳定)' },
  // 悠船文生图 v8.1（语义真实时代，文本渲染 + 全景光照，required: hd）
  { id: 'youchuan/text-to-image-v81', capability: 'image', description: '悠船文生图 v8.1' },
  // 全能图片G-2.0 文生图（低价渠道版，顶级图像底座，文本渲染）
  { id: 'rhart-image-g-2/text-to-image', capability: 'image', description: '全能图片G-2.0 文生图 (低价渠道)' },
  // 可灵 o3 系列（文档 448183110-448183113, 448183161-448183162, 449426881-449426885）
  { id: 'kling-video-o3-pro/text-to-video', capability: 'video', description: '可灵 o3-pro 文生视频' },
  { id: 'kling-video-o3-std/text-to-video', capability: 'video', description: '可灵 o3-std 文生视频' },
  { id: 'kling-video-o3-pro/image-to-video', capability: 'video', description: '可灵 o3-pro 图生视频' },
  { id: 'kling-video-o3-std/image-to-video', capability: 'video', description: '可灵 o3-std 图生视频' },
  { id: 'kling-video-o3-4k/text-to-video', capability: 'video', description: '可灵 o3-4k 文生视频' },
  { id: 'kling-video-o3-4k/image-to-video', capability: 'video', description: '可灵 o3-4k 图生视频' },
  { id: 'kling-video-o3-pro/reference-to-video', capability: 'video', description: '可灵 o3-pro 参考生视频' },
  // 可灵 3.0 文生/图生（文档 448183163-448183164, 449426882）
  { id: 'kling-v3.0-pro/text-to-video', capability: 'video', description: '可灵 v3.0-pro 文生视频' },
  { id: 'kling-v3.0-std/text-to-video', capability: 'video', description: '可灵 v3.0-std 文生视频' },
  { id: 'kling-v3.0-pro/image-to-video', capability: 'video', description: '可灵 v3.0-pro 图生视频' },
  { id: 'kling-v3.0-std/image-to-video', capability: 'video', description: '可灵 v3.0-std 图生视频' },
  { id: 'kling-v3.0-4k/image-to-video', capability: 'video', description: '可灵 v3.0-4k 图生视频' },
  // 可灵 2.6（文档 448183152, 448183117, 448183294）
  { id: 'kling-v2.6-pro/text-to-video', capability: 'video', description: '可灵 v2.6-pro 文生视频' },
  { id: 'kling-v2.6-pro/image-to-video', capability: 'video', description: '可灵 v2.6-pro 图生视频' },
  { id: 'kling-v2.6-std/image-to-video', capability: 'video', description: '可灵 v2.6-std 图生视频' },
  // 万相 2.6 / 2.7（文档 448183104-448183108, 448183155, 448183159, 448183185）
  { id: 'rhart-video/wan-2.6/text-to-video', capability: 'video', description: '万相 2.6 文生视频' },
  { id: 'rhart-video/wan-2.6/image-to-video', capability: 'video', description: '万相 2.6 图生视频' },
  { id: 'rhart-video/wan-2.6/reference-to-video', capability: 'video', description: '万相 2.6 参考生视频' },
  { id: 'rhart-video/wan-2.6-flash/image-to-video', capability: 'video', description: '万相 2.6 Flash 图生视频' },
  { id: 'rhart-video/wan-2.7/text-to-video', capability: 'video', description: '万相 2.7 文生视频' },
  { id: 'rhart-video/wan-2.7/image-to-video', capability: 'video', description: '万相 2.7 图生视频' },
  { id: 'rhart-video/wan-2.7/reference-to-video', capability: 'video', description: '万相 2.7 参考生视频' },
  { id: 'rhart-video/wan-2.7/video-extend', capability: 'video', description: '万相 2.7 视频续写' },
  { id: 'rhart-video/wan-2.7/video-edit', capability: 'video', description: '万相 2.7 视频编辑' },
  // Vidu q3-turbo / q2-pro-fast 系列（文档 448183059-448183068, 448183131）
  { id: 'vidu/text-to-video-q3-turbo', capability: 'video', description: 'Vidu Q3 Turbo 文生视频' },
  { id: 'vidu/image-to-video-q3-turbo', capability: 'video', description: 'Vidu Q3 Turbo 图生视频' },
  { id: 'vidu/image-to-video-q2-pro-fast', capability: 'video', description: 'Vidu Q2 Pro Fast 图生视频' },
  { id: 'vidu/start-end-to-video-q3-pro', capability: 'video', description: 'Vidu Q3 Pro 首尾帧生视频' },
  { id: 'vidu/start-end-to-video-q3-turbo', capability: 'video', description: 'Vidu Q3 Turbo 首尾帧生视频' },
  { id: 'vidu/start-end-to-video-q2-pro', capability: 'video', description: 'Vidu Q2 Pro 首尾帧生视频' },
  // 海螺 2.3 系列（文档 448183075-448183079, 448183137-448183139）
  { id: 'rhart-video/hailuo-2.3/text-to-video', capability: 'video', description: '海螺 2.3 文生视频' },
  { id: 'rhart-video/hailuo-2.3/image-to-video', capability: 'video', description: '海螺 2.3 图生视频' },
  { id: 'rhart-video/hailuo-2.3-pro/text-to-video', capability: 'video', description: '海螺 2.3-pro 文生视频' },
  { id: 'rhart-video/hailuo-2.3-fast/image-to-video', capability: 'video', description: '海螺 2.3-fast 图生视频' },
  { id: 'rhart-video/hailuo-2.3-fast-pro/image-to-video', capability: 'video', description: '海螺 2.3-fast-pro 图生视频' },
  // MiniMax-H3（文档 495380672-495380674）
  { id: 'rhart-video/minimax-h3/text-to-video', capability: 'video', description: 'MiniMax-H3 文生视频' },
  { id: 'rhart-video/minimax-h3/image-to-video', capability: 'video', description: 'MiniMax-H3 图生视频（首尾帧）' },
  { id: 'rhart-video/minimax-h3/reference-to-video', capability: 'video', description: 'MiniMax-H3 多模态参考生视频' },
  // FLUX 3 Video（文档 498749506-498749511）
  { id: 'rhart-video/flux-3/text-to-video', capability: 'video', description: 'FLUX 3 Video 文生视频' },
  { id: 'rhart-video/flux-3/image-to-video', capability: 'video', description: 'FLUX 3 Video 图生视频' },
  { id: 'rhart-video/flux-3/video-edit', capability: 'video', description: 'FLUX 3 Video 草稿增强' },
  { id: 'rhart-video/flux-3/video-extend', capability: 'video', description: 'FLUX 3 Video 视频续生' },
  // seedream v5 文生/图生（文档 494858272, 494858277, 498427805）
  { id: 'rhart-image/seedream-v5/text-to-image', capability: 'image', description: 'Seedream v5-pro 文生图' },
  { id: 'rhart-image/seedream-v5/image-to-image', capability: 'image', description: 'Seedream v5-pro 图生图' },
  { id: 'rhart-image/seedream-v5/layer-split', capability: 'image', description: 'Seedream v5-pro 图层拆分' },
  // SkyReels V4 文生/图生/std（文档 454760434-454760437）
  { id: 'skyreels-v4/text-to-video-fast', capability: 'video', description: 'SkyReels V4 文生视频 (fast)' },
  { id: 'skyreels-v4/text-to-video-std', capability: 'video', description: 'SkyReels V4 文生视频 (std)' },
  { id: 'skyreels-v4/image-to-video-fast', capability: 'video', description: 'SkyReels V4 图生视频 (fast)' },
  { id: 'skyreels-v4/image-to-video-std', capability: 'video', description: 'SkyReels V4 图生视频 (std)' },
  // 全能视频X v1.5（文档 498749504, 498749508, 494858291）
  { id: 'rhart-video-x-v1.5/text-to-video', capability: 'video', description: '全能视频X v1.5 文生视频' },
  { id: 'rhart-video-x-v1.5/image-to-video', capability: 'video', description: '全能视频X v1.5 图生视频' },
  { id: 'rhart-video-x-v1.5/reference-to-video', capability: 'video', description: '全能视频X v1.5 参考生视频' },
  // seedance 2.5（文档 498749503-498749507）
  { id: 'rhart-video/sparkvideo-2.5/text-to-video', capability: 'video', description: 'Seedance 2.5 文生视频' },
  { id: 'rhart-video/sparkvideo-2.5/image-to-video', capability: 'video', description: 'Seedance 2.5 图生视频' },
  { id: 'rhart-video/sparkvideo-2.5/multimodal-video', capability: 'video', description: 'Seedance 2.5 多模态视频' },
];

// RunningHub 产品展示名 → 真实 API endpoint 的别名映射。
// 用户在设置页手填 RH 官网"产品名"（如 nano-banana-pro/edit-channel-low-price）时，
// 通过这里自动重写为真实的 /openapi/v2/<endpoint> 路径，避免 404。
// 家族别名：不含版本的家族名 -> 该系列当前默认端点。
// 官方发布新版本时：用户可直接填新 endpoint（未命中 alias 时原样透传），无需更新本表。
const RUNNINGHUB_FAMILY_ALIASES: Record<string, string> = {
  '可灵文生视频': 'kling-video-o3-pro/text-to-video',
  '可灵图生视频': 'kling-video-o3-pro/image-to-video',
  '可灵首尾帧生视频': 'kling-video-o3-pro/start-end-to-video',
  '可灵参考生视频': 'kling-video-o3-pro/reference-to-video',
  '可灵文生视频pro': 'kling-video-o3-pro/text-to-video',
  '可灵图生视频pro': 'kling-video-o3-pro/image-to-video',
  '可灵文生视频std': 'kling-video-o3-std/text-to-video',
  '可灵图生视频std': 'kling-video-o3-std/image-to-video',
  '万相文生视频': 'rhart-video/wan-2.7/text-to-video',
  '万相图生视频': 'rhart-video/wan-2.7/image-to-video',
  '万相参考生视频': 'rhart-video/wan-2.7/reference-to-video',
  '万相文生图': 'rhart-image/wan-2.7/text-to-image',
  '万相图生图': 'rhart-image/wan-2.7/image-to-image',
  'vidu文生视频': 'vidu/text-to-video-q3-pro',
  'vidu图生视频': 'vidu/image-to-video-q3-pro',
  'vidu首尾帧生视频': 'vidu/start-end-to-video-q3-pro',
  'Vidu文生视频': 'vidu/text-to-video-q3-pro',
  'Vidu图生视频': 'vidu/image-to-video-q3-pro',
  'Vidu首尾帧生视频': 'vidu/start-end-to-video-q3-pro',
  '海螺文生视频': 'rhart-video/hailuo-2.3/text-to-video',
  '海螺图生视频': 'rhart-video/hailuo-2.3/image-to-video',
  'seedance文生视频': 'rhart-video/sparkvideo-2.5/text-to-video',
  'seedance图生视频': 'rhart-video/sparkvideo-2.5/image-to-video',
  'seedance多模态视频': 'rhart-video/sparkvideo-2.5/multimodal-video',
  'seedream文生图': 'rhart-image/seedream-v5/text-to-image',
  'seedream图生图': 'rhart-image/seedream-v5/image-to-image',
  '全能视频X文生视频': 'rhart-video-x-v1.5/text-to-video',
  '全能视频X图生视频': 'rhart-video-x-v1.5/image-to-video',
  '全能视频X参考生视频': 'rhart-video-x-v1.5/reference-to-video',
  'skyreels文生视频': 'skyreels-v4/text-to-video-std',
  'skyreels图生视频': 'skyreels-v4/image-to-video-std',
  'miniMax-H3文生视频': 'rhart-video/minimax-h3/text-to-video',
  'miniMax-H3图生视频': 'rhart-video/minimax-h3/image-to-video',
  'flux文生视频': 'rhart-video/flux-3/text-to-video',
  'flux图生视频': 'rhart-video/flux-3/image-to-video',
};

const RUNNINGHUB_PRODUCT_ALIASES: Record<string, string> = {
  'nano-banana/edit-channel-low-price': 'rhart-image-v1/edit',
  'nano-banana/edit-official-stable': 'rhart-image-v1-official/edit',
  'nano-banana/text-to-image-channel-low-price': 'rhart-image-v1/text-to-image',
  'nano-banana-pro/edit-channel-low-price': 'rhart-image-n-pro/edit',
  'nano-banana-pro/edit-official-stable': 'rhart-image-n-pro-official/edit',
  'nano-banana-pro/edit-ultra-official-stable': 'rhart-image-n-pro-official/edit-ultra',
  'nano-banana-pro/text-to-image-channel-low-price': 'rhart-image-n-pro/text-to-image',
  'nano-banana-pro/text-to-image-official-stable': 'rhart-image-n-pro-official/text-to-image',
  'nano-banana2-gemini31flash/image-to-image-channel-low-price': 'rhart-image-n-g31-flash/image-to-image',
  'nano-banana2-gemini31flash/image-to-image-official-stable': 'rhart-image-n-g31-flash/image-to-image',
  // Seedance 2.0 官方标准模型在 RH API 里使用 rhart-video/sparkvideo-2.0 命名空间。
  'seedance-2.0-global/multimodal-video': 'rhart-video/sparkvideo-2.0/multimodal-video',
  'seedance-2.0-global/image-to-video': 'rhart-video/sparkvideo-2.0/image-to-video',
  'seedance-2.0-global/text-to-video': 'rhart-video/sparkvideo-2.0/text-to-video',
  'seedance-2.0-global-fast/multimodal-video': 'rhart-video/sparkvideo-2.0-fast/multimodal-video',
  'seedance-2.0-global-fast/image-to-video': 'rhart-video/sparkvideo-2.0-fast/image-to-video',
  'seedance-2.0-global-fast/text-to-video': 'rhart-video/sparkvideo-2.0-fast/text-to-video',
  'bytedance/seedance-2.0-global/multimodal-video': 'rhart-video/sparkvideo-2.0/multimodal-video',
  'bytedance/seedance-2.0-global/image-to-video': 'rhart-video/sparkvideo-2.0/image-to-video',
  'bytedance/seedance-2.0-global/text-to-video': 'rhart-video/sparkvideo-2.0/text-to-video',
  'bytedance/seedance-2.0-global-fast/multimodal-video': 'rhart-video/sparkvideo-2.0-fast/multimodal-video',
  'bytedance/seedance-2.0-global-fast/image-to-video': 'rhart-video/sparkvideo-2.0-fast/image-to-video',
  'bytedance/seedance-2.0-global-fast/text-to-video': 'rhart-video/sparkvideo-2.0-fast/text-to-video',
  'seedance2.0/文生视频': 'rhart-video/sparkvideo-2.0/text-to-video',
  'seedance2.0/图生视频': 'rhart-video/sparkvideo-2.0/image-to-video',
  'seedance2.0/多模态视频': 'rhart-video/sparkvideo-2.0/multimodal-video',
  'seedance2.0-fast/文生视频': 'rhart-video/sparkvideo-2.0-fast/text-to-video',
  'seedance2.0-fast/图生视频': 'rhart-video/sparkvideo-2.0-fast/image-to-video',
  'seedance2.0-fast/多模态视频': 'rhart-video/sparkvideo-2.0-fast/multimodal-video',
  'seedance2.0/text-to-video': 'rhart-video/sparkvideo-2.0/text-to-video',
  'seedance2.0/image-to-video': 'rhart-video/sparkvideo-2.0/image-to-video',
  'seedance2.0/multimodal-video': 'rhart-video/sparkvideo-2.0/multimodal-video',
  'seedance2.0-fast/text-to-video': 'rhart-video/sparkvideo-2.0-fast/text-to-video',
  'seedance2.0-fast/image-to-video': 'rhart-video/sparkvideo-2.0-fast/image-to-video',
  'seedance2.0-fast/multimodal-video': 'rhart-video/sparkvideo-2.0-fast/multimodal-video',
  // Wan 2.2 真实 endpoint 在 rhart-video/ 子命名空间下
  'wan-2.2/image-to-video': 'rhart-video/wan-2.2/image-to-video',
  'wan-2.2/text-to-video': 'rhart-video/wan-2.2/text-to-video',
  // 可灵 o3 / 3.0 / 2.6
  'kling-video-o3-pro/text-to-video': 'kling-video-o3-pro/text-to-video',
  'kling-video-o3-std/text-to-video': 'kling-video-o3-std/text-to-video',
  'kling-video-o3-pro/image-to-video': 'kling-video-o3-pro/image-to-video',
  'kling-video-o3-std/image-to-video': 'kling-video-o3-std/image-to-video',
  'kling-video-o3-4k/text-to-video': 'kling-video-o3-4k/text-to-video',
  'kling-video-o3-4k/image-to-video': 'kling-video-o3-4k/image-to-video',
  'kling-video-o3-pro/reference-to-video': 'kling-video-o3-pro/reference-to-video',
  '可灵文生视频o3-pro': 'kling-video-o3-pro/text-to-video',
  '可灵文生视频o3-std': 'kling-video-o3-std/text-to-video',
  '可灵图生视频o3-pro': 'kling-video-o3-pro/image-to-video',
  '可灵图生视频o3-std': 'kling-video-o3-std/image-to-video',
  'kling-v3.0-pro/text-to-video': 'kling-v3.0-pro/text-to-video',
  'kling-v3.0-std/text-to-video': 'kling-v3.0-std/text-to-video',
  'kling-v3.0-pro/image-to-video': 'kling-v3.0-pro/image-to-video',
  'kling-v3.0-std/image-to-video': 'kling-v3.0-std/image-to-video',
  '可灵文生视频3.0-pro': 'kling-v3.0-pro/text-to-video',
  '可灵文生视频3.0-std': 'kling-v3.0-std/text-to-video',
  '可灵图生视频3.0-pro': 'kling-v3.0-pro/image-to-video',
  '可灵图生视频3.0-std': 'kling-v3.0-std/image-to-video',
  'kling-v2.6-pro/text-to-video': 'kling-v2.6-pro/text-to-video',
  '可灵文生视频2.6-pro': 'kling-v2.6-pro/text-to-video',
  '可灵文生视频2.6-标准版': 'kling-v2.6-std/text-to-video',
  '可灵图生视频2.6-pro': 'kling-v2.6-pro/image-to-video',
  '可灵图生视频2.6-标准版': 'kling-v2.6-std/image-to-video',
  // 万相 2.6 / 2.7
  'wan-2.6/text-to-video': 'rhart-video/wan-2.6/text-to-video',
  'wan-2.6/image-to-video': 'rhart-video/wan-2.6/image-to-video',
  'wan-2.6/reference-to-video': 'rhart-video/wan-2.6/reference-to-video',
  'wan-2.7/text-to-video': 'rhart-video/wan-2.7/text-to-video',
  'wan-2.7/image-to-video': 'rhart-video/wan-2.7/image-to-video',
  'wan-2.7/reference-to-video': 'rhart-video/wan-2.7/reference-to-video',
  '万相2.6-文生视频': 'rhart-video/wan-2.6/text-to-video',
  '万相2.6-图生视频': 'rhart-video/wan-2.6/image-to-video',
  '万相2.6-参考生视频': 'rhart-video/wan-2.6/reference-to-video',
  '万相2.7-文生视频': 'rhart-video/wan-2.7/text-to-video',
  '万相2.7-图生视频': 'rhart-video/wan-2.7/image-to-video',
  '万相2.7-参考生视频': 'rhart-video/wan-2.7/reference-to-video',
  // Vidu Q3/Q2 新版本
  'vidu/text-to-video-q3-turbo': 'vidu/text-to-video-q3-turbo',
  'vidu/image-to-video-q3-turbo': 'vidu/image-to-video-q3-turbo',
  'vidu/start-end-to-video-q3-pro': 'vidu/start-end-to-video-q3-pro',
  'Vidu-文生视频-q3-turbo': 'vidu/text-to-video-q3-turbo',
  'Vidu-图生视频-q3-turbo': 'vidu/image-to-video-q3-turbo',
  'Vidu-首尾帧生视频-q3-pro': 'vidu/start-end-to-video-q3-pro',
  // 海螺 2.3 / MiniMax-H3 / FLUX 3 / SkyReels V4 / seedance 2.5 / seedream v5
  'hailuo-2.3/text-to-video': 'rhart-video/hailuo-2.3/text-to-video',
  'hailuo-2.3/image-to-video': 'rhart-video/hailuo-2.3/image-to-video',
  '海螺-2.3-文生视频-标准': 'rhart-video/hailuo-2.3/text-to-video',
  '海螺-2.3-图生视频-标准': 'rhart-video/hailuo-2.3/image-to-video',
  '海螺-2.3-图生视频-pro': 'rhart-video/hailuo-2.3-pro/image-to-video',
  '海螺-2.3-fast-图生视频': 'rhart-video/hailuo-2.3-fast/image-to-video',
  'minimax-h3/text-to-video': 'rhart-video/minimax-h3/text-to-video',
  'MiniMax-H3 文生视频': 'rhart-video/minimax-h3/text-to-video',
  'MiniMax-H3 图生视频（首尾帧）': 'rhart-video/minimax-h3/image-to-video',
  'flux-3/text-to-video': 'rhart-video/flux-3/text-to-video',
  'FLUX 3 Video 文生视频': 'rhart-video/flux-3/text-to-video',
  'FLUX 3 Video 图生视频': 'rhart-video/flux-3/image-to-video',
  'seedream-v5/text-to-image': 'rhart-image/seedream-v5/text-to-image',
  'seedream-v5/image-to-image': 'rhart-image/seedream-v5/image-to-image',
  'seedream-v5-pro-文生图': 'rhart-image/seedream-v5/text-to-image',
  'seedream-v5-pro-图生图': 'rhart-image/seedream-v5/image-to-image',
  'sparkvideo-2.5/text-to-video': 'rhart-video/sparkvideo-2.5/text-to-video',
  'seedance2.5/文生视频': 'rhart-video/sparkvideo-2.5/text-to-video',
  'seedance2.5/图生视频': 'rhart-video/sparkvideo-2.5/image-to-video',
  'seedance2.5/多模态视频': 'rhart-video/sparkvideo-2.5/multimodal-video',
  // 全能视频 V3.1 低价渠道展示名（页面 slug）→ 官方标准模型 endpoint
  'google/veo3.1-fast/text-to-video-channel-low-price': 'rhart-video-v3.1-fast/text-to-video',
  'google/veo3.1-fast/image-to-video-channel-low-price': 'rhart-video-v3.1-fast/image-to-video',
  'google/veo3.1-fast/start-end-to-video-channel-low-price': 'rhart-video-v3.1-fast/start-end-to-video',
  'google/veo3.1-pro/text-to-video-channel-low-price': 'rhart-video-v3.1-pro/text-to-video',
  'google/veo3.1-pro/image-to-video-channel-low-price': 'rhart-video-v3.1-pro/image-to-video',
  'google/veo3.1-pro/start-end-to-video-channel-low-price': 'rhart-video-v3.1-pro/start-end-to-video',
};

export interface RHTaskResult {
  url: string;
  nodeId: string;
  outputType: string; // png, mp4, txt, etc.
  text: string | null;
}

export interface RHTaskResponse {
  taskId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  errorCode: string;
  errorMessage: string;
  results: RHTaskResult[] | null;
  clientId: string;
  usage?: {
    consumeMoney: string | null;
    consumeCoins: string | null;
    taskCostTime: string;
    thirdPartyConsumeMoney: string | null;
  };
}

export interface RHSubmitPayload {
  webhookUrl?: string;
  [key: string]: unknown; // RunningHub standard model fields, e.g. 12##text
}

export interface RHRunOptions {
  baseUrl?: string;
  signal?: AbortSignal;
  onProgress?: (status: RHTaskResponse['status'], attempt: number) => void;
}

type RHDebugContext = {
  baseUrl: string;
  modelEndpoint?: string;
  submitUrl?: string;
  taskId?: string;
  payload?: RHSubmitPayload;
  response?: Partial<RHTaskResponse> & Record<string, unknown>;
};

function rhHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function rhResponseError(json: any, phase: string) {
  const code = firstString(json?.errorCode, json?.code);
  const directMessage = firstString(
    json?.errorMessage,
    json?.msg,
    json?.message,
    json?.failedReason?.exception_message,
    json?.failedReason?.message,
  );
  const message = firstString(
    directMessage,
    json?.promptTips,
  );
  const statusUpper = String(json?.status || '').toUpperCase();
  if (statusUpper === 'SUCCESS') return '';
  const failed = statusUpper === 'FAILED' || statusUpper === 'ERROR';
  if (!failed) {
    const code0 = !code || code === '0' || code === '200';
    const msgIsSuccess = !directMessage || /(success|成功)/i.test(directMessage);
    if (code0 && msgIsSuccess) return '';
  }
  const codeText = code && code !== '0' ? ` (${code})` : '';
  return `${phase} failed${codeText}: ${message || 'Unknown error'}`;
}

function rhBase(baseUrl?: string) {
  return (baseUrl || RH_BASE).trim().replace(/\/+$/, '');
}

function runningHubApiDocEndpoint(value: string) {
  const docId = value.match(/(?:^|\/)runninghub-api-doc(?:-cn)?\/api-(\d+)(?:\.md)?$/i)?.[1]
    || value.match(/^api-(\d+)(?:\.md)?$/i)?.[1];
  return docId ? resolveRouteIdByDocId(docId) : undefined;
}

function truncateDebugText(value: string, max = 120) {
  return value.length <= max ? value : `${value.slice(0, max)}...(${value.length})`;
}

function summarizeDebugUrl(value: string) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${truncateDebugText(parsed.pathname || '/', 72)}`;
  } catch {
    return truncateDebugText(value);
  }
}

function summarizePayloadValue(key: string, value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      count: value.length,
      sample: value.slice(0, 3).map(item => summarizePayloadValue(key, item)),
    };
  }
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) return summarizeDebugUrl(value);
    if (/(^|##)(text|prompt)$/i.test(key) || /(?:prompt|description|caption)/i.test(key)) {
      return `[text ${value.length} chars]`;
    }
    return truncateDebugText(value, 48);
  }
  if (value && typeof value === 'object') {
    return '[object]';
  }
  return value;
}

function summarizePayload(payload?: RHSubmitPayload) {
  if (!payload) return undefined;
  return Object.fromEntries(
    Object.entries(payload)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, summarizePayloadValue(key, value)]),
  );
}

function summarizeResponse(response?: Partial<RHTaskResponse> & Record<string, unknown>) {
  if (!response) return undefined;
  const dataObj = (response as any)?.data;
  return {
    status: firstString(response.status),
    taskId: firstString(response.taskId),
    errorCode: firstString(response.errorCode, response.code),
    errorMessage: firstString(
      response.errorMessage,
      response.message,
      response.msg,
      (response as any)?.failedReason?.exception_message,
      (response as any)?.failedReason?.message,
    ),
    resultCount: Array.isArray(response.results) ? response.results.length : undefined,
    // Upload binary endpoint returns { code, message, data: { download_url, fileName, ... } }.
    // Include it here so upload failures actually show the URL field instead of looking empty.
    dataDownloadUrl: dataObj && typeof dataObj === 'object' ? firstString(dataObj.download_url, dataObj.fileUrl, dataObj.url) : undefined,
    dataFileName: dataObj && typeof dataObj === 'object' ? firstString(dataObj.fileName) : undefined,
  };
}

function runningHubDebugContext(baseUrl: string, modelEndpoint?: string, payload?: RHSubmitPayload): RHDebugContext {
  const normalizedEndpoint = modelEndpoint ? normalizeRunningHubModelEndpoint(modelEndpoint) : '';
  const normalizedBaseUrl = rhBase(baseUrl);
  return {
    baseUrl: normalizedBaseUrl,
    modelEndpoint: normalizedEndpoint || undefined,
    submitUrl: normalizedEndpoint ? `${normalizedBaseUrl}/${normalizedEndpoint}` : undefined,
    payload,
  };
}

function formatRunningHubDebug(context: RHDebugContext) {
  return `\n[RunningHub Debug] ${JSON.stringify({
    baseUrl: context.baseUrl,
    modelEndpoint: context.modelEndpoint,
    submitUrl: context.submitUrl,
    taskId: context.taskId,
    payload: summarizePayload(context.payload),
    response: summarizeResponse(context.response),
  }, null, 2)}`;
}

function withRunningHubDebug(message: string, context: RHDebugContext) {
  const debug = formatRunningHubDebug(context);
  if (typeof console !== 'undefined') {
    console.error('[RunningHub Debug]', {
      baseUrl: context.baseUrl,
      modelEndpoint: context.modelEndpoint,
      submitUrl: context.submitUrl,
      taskId: context.taskId,
      payload: summarizePayload(context.payload),
      response: summarizeResponse(context.response),
    });
  }
  return `${message}${debug}`;
}

export function normalizeRunningHubModelEndpoint(modelEndpoint?: string) {
  let value = (modelEndpoint || '').trim().replace(/\\/g, '/');
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      const detailId = parsed.pathname.match(/\/call-api\/api-detail\/(\d+)/i)?.[1];
      if (detailId && RUNNINGHUB_DETAIL_ENDPOINTS[detailId]) return RUNNINGHUB_DETAIL_ENDPOINTS[detailId];
      const docEndpoint = runningHubApiDocEndpoint(parsed.pathname);
      if (docEndpoint) return docEndpoint;
      value = parsed.pathname || '';
    } catch {
      return '';
    }
  }
  value = value
    .split('#')[0]
    .split('?')[0]
    .trim()
    .replace(/^\/+/, '')
    .replace(/^openapi\/v2\/?/i, '')
    .replace(/^runninghub\/+/i, '')
    .replace(/\/+$/, '');
  const docEndpoint = runningHubApiDocEndpoint(value);
  if (docEndpoint) return docEndpoint;
  const alias = RUNNINGHUB_PRODUCT_ALIASES[value.toLowerCase()];
  if (alias) return alias;
  // 家族名匹配：不含版本的家族名（含空格/大小写归一）落到该系列默认端点
  const familyKey = value.toLowerCase().replace(/\s+/g, '');
  const familyAlias = RUNNINGHUB_FAMILY_ALIASES[familyKey];
  if (familyAlias) return familyAlias;
  return value;
}

export function isLikelyRunningHubModelEndpoint(modelEndpoint?: string) {
  const normalized = normalizeRunningHubModelEndpoint(modelEndpoint);
  if (!normalized) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(normalized)) return false;
  if (/^(query|page-api)$/i.test(normalized)) return false;
  if (/^media\/upload\/binary$/i.test(normalized)) return false;
  if (/^(call-api|search-api|runninghub-api-doc)/i.test(normalized)) return false;
  return true;
}

export function assertRunningHubModelEndpoint(modelEndpoint?: string) {
  const normalized = normalizeRunningHubModelEndpoint(modelEndpoint);
  if (!isLikelyRunningHubModelEndpoint(normalized)) {
    throw new Error('RunningHub 模型 ID 无效，请先在设置中点击"获取模型"并重新选择官方标准模型。');
  }
  return normalized;
}

function rhTaskUrl(baseUrl: string, modelEndpoint: string) {
  return `${rhBase(baseUrl)}/${assertRunningHubModelEndpoint(modelEndpoint)}`;
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason || new DOMException('RunningHub request aborted', 'AbortError');
}

const RH_FETCH_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, userSignal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('RunningHub request timeout', 'TimeoutError')), timeoutMs);
  if (userSignal) {
    if (userSignal.aborted) {
      clearTimeout(timer);
      controller.abort(userSignal.reason);
    } else {
      userSignal.addEventListener('abort', () => {
        clearTimeout(timer);
        controller.abort(userSignal.reason);
      }, { once: true });
    }
  }
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException('RunningHub request aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('RunningHub request aborted', 'AbortError'));
    }, { once: true });
  });
}

/** Submit a task to a RunningHub model endpoint */
export async function rhSubmitTask(
  apiKey: string,
  modelEndpoint: string,
  payload: RHSubmitPayload,
  options: Pick<RHRunOptions, 'baseUrl' | 'signal'> = {},
): Promise<RHTaskResponse> {
  assertNotAborted(options.signal);
  const debugContext = runningHubDebugContext(options.baseUrl || RH_BASE, modelEndpoint, payload);
  const url = rhTaskUrl(options.baseUrl || RH_BASE, modelEndpoint);
  const startedAt = Date.now();

  console.log('[RH Debug] rhSubmitTask fetch start', { url, payloadKeys: Object.keys(payload || {}), payloadSize: JSON.stringify(payload).length });
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: rhHeaders(apiKey),
    body: JSON.stringify(payload),
  }, 60_000, options.signal);
  const durationMs = Date.now() - startedAt;
  console.log('[RH Debug] rhSubmitTask response raw', { status: res.status, ok: res.ok, durationMs, contentType: res.headers.get('content-length'), ct: res.headers.get('content-type') });

  if (!res.ok) {
    const text = await res.text();
    console.error('[RH Debug] rhSubmitTask !res.ok', { status: res.status, durationMs, body: truncateDebugText(text, 200) });
    throw new Error(withRunningHubDebug(`RunningHub submit failed (${res.status}): ${text}`, debugContext));
  }
  const json = await res.json();
  console.log('[RH Debug] rhSubmitTask json', truncateDebugText(JSON.stringify(json), 200));
  const error = rhResponseError(json, 'RunningHub submit');
  if (error) {
    console.error('[RH Debug] rhSubmitTask flagged error', { rhErr: error, response: truncateDebugText(JSON.stringify(json), 200) });
    throw new Error(withRunningHubDebug(error, { ...debugContext, response: json }));
  }
  console.log('[RH Debug] rhSubmitTask OK', { taskId: json?.taskId, status: json?.status, durationMs });
  return json;
}

/** Query task status */
export async function rhQueryTask(
  apiKey: string,
  taskId: string,
  options: Pick<RHRunOptions, 'baseUrl' | 'signal'> = {},
): Promise<RHTaskResponse> {
  assertNotAborted(options.signal);
  const startedAt = Date.now();
  const res = await fetchWithTimeout(`${rhBase(options.baseUrl)}/query`, {
    method: 'POST',
    headers: rhHeaders(apiKey),
    body: JSON.stringify({ taskId }),
  }, RH_FETCH_TIMEOUT_MS, options.signal);
  const durationMs = Date.now() - startedAt;

  if (!res.ok) {
    const text = await res.text();
    console.error('[RH Debug] rhQueryTask !res.ok', { status: res.status, taskId, durationMs, body: truncateDebugText(text, 200) });
    throw new Error(withRunningHubDebug(`RunningHub query failed (${res.status}): ${text}`, {
      baseUrl: rhBase(options.baseUrl),
      taskId,
    }));
  }
  const json = await res.json();
  console.log('[RH Debug] rhQueryTask result', { taskId, status: json?.status, durationMs, hasResults: !!json?.results, resultsCount: json?.results?.length });
  const error = rhResponseError(json, 'RunningHub query');
  if (error) throw new Error(withRunningHubDebug(error, {
    baseUrl: rhBase(options.baseUrl),
    taskId,
    response: json,
  }));
  return json;
}

/**
 * Cancel a RunningHub server task (best-effort).
 *
 * Endpoint: POST {RH_HOST}/task/openapi/cancel with body {apiKey, taskId}.
 * Documented under ComfyUI Workflows but works for any taskId returned by the
 * v2 standard model API (unified task system). Swallows all errors so abort
 * flow is never blocked by a failed cancel.
 */
export async function rhCancelTask(
  apiKey: string,
  taskId: string,
  options: Pick<RHRunOptions, 'baseUrl'> = {},
): Promise<void> {
  if (!apiKey || !taskId) return;
  const host = (options.baseUrl || RH_HOST).replace(/\/openapi\/v2\/?$/i, '').replace(/\/+$/, '');
  const url = `${host}/task/openapi/cancel`;
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: rhHeaders(apiKey),
      body: JSON.stringify({ apiKey, taskId }),
    }, 15_000);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[RunningHub] cancel request failed', { status: res.status, taskId, body: text });
      return;
    }
    const json = await res.json();
    const code = firstString(json?.code);
    if (code && code !== '0') {
      console.warn('[RunningHub] cancel returned non-success', { code, msg: json?.msg, taskId });
    }
  } catch (err) {
    console.warn('[RunningHub] cancel request threw', { taskId, error: err });
  }
}

/** Upload a file and get a temporary URL (valid 24h) */
export async function rhUploadFile(
  apiKey: string,
  file: File | Blob,
  fileName?: string,
  options: Pick<RHRunOptions, 'baseUrl' | 'signal'> = {},
): Promise<string> {
  assertNotAborted(options.signal);
  const formData = new FormData();
  formData.append('file', file, fileName || 'upload.png');
  const uploadUrl = `${rhBase(options.baseUrl)}/media/upload/binary`;
  const startedAt = Date.now();
  console.log('[RH Debug] rhUploadFile fetch start', { url: uploadUrl, hasKey: !!apiKey, blobSize: file.size, blobType: file.type, fileName: fileName || 'upload.png' });

  const res = await fetch(uploadUrl, {
    signal: options.signal,
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
  const durationMs = Date.now() - startedAt;
  console.log('[RH Debug] rhUploadFile response', { status: res.status, ok: res.ok, durationMs, contentType: res.headers.get('content-length'), ct: res.headers.get('content-type') });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(withRunningHubDebug(`RunningHub upload failed (${res.status}): ${text}`, {
      baseUrl: rhBase(options.baseUrl),
      submitUrl: uploadUrl,
    }));
  }

  const json = await res.json();
  console.log('[RH Debug] rhUploadFile json', truncateDebugText(JSON.stringify(json), 200));
  const error = rhResponseError(json, 'RunningHub upload');
  if (error) throw new Error(withRunningHubDebug(error, {
    baseUrl: rhBase(options.baseUrl),
    submitUrl: uploadUrl,
    response: json,
  }));
  const url = firstString(json.data?.download_url, json.data?.fileUrl, json.data?.url, json.download_url, json.fileUrl, json.url);
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(withRunningHubDebug('RunningHub upload failed: 未返回可用媒体 URL。', {
      baseUrl: rhBase(options.baseUrl),
      submitUrl: uploadUrl,
      response: json,
    }));
  }
  return url;
}

/** Convert a data URL to a Blob for upload */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Upload a data URL image and get a temporary URL */
export async function rhUploadDataUrl(
  apiKey: string,
  dataUrl: string,
  options: Pick<RHRunOptions, 'baseUrl' | 'signal'> = {},
): Promise<string> {
  const blob = dataUrlToBlob(dataUrl);
  const ext = blob.type.split('/')[1] || 'png';
  return rhUploadFile(apiKey, blob, `upload.${ext}`, options);
}

/**
 * Submit a task and poll until completion.
 * Returns the final task response with results.
 */
export async function rhRunTask(
  apiKey: string,
  modelEndpoint: string,
  payload: RHSubmitPayload,
  onProgressOrOptions?: ((status: string, attempt: number) => void) | RHRunOptions,
): Promise<RHTaskResponse> {
  const options: RHRunOptions = typeof onProgressOrOptions === 'function'
    ? { onProgress: onProgressOrOptions as RHRunOptions['onProgress'] }
    : onProgressOrOptions || {};
  const debugContext = runningHubDebugContext(options.baseUrl || RH_BASE, modelEndpoint, payload);
  const submitResult = await rhSubmitTask(apiKey, modelEndpoint, payload, options);
  if (submitResult.status === 'SUCCESS') return submitResult;
  if (submitResult.status === 'FAILED') {
    throw new Error(withRunningHubDebug(`RunningHub task failed: ${submitResult.errorMessage || 'Unknown error'}`, {
      ...debugContext,
      response: { ...submitResult },
    }));
  }
  const taskId = submitResult.taskId;
  if (!taskId) {
    throw new Error(withRunningHubDebug('RunningHub submit failed: 未返回 taskId，请检查模型端点和输入媒体 URL。', {
      ...debugContext,
      response: { ...submitResult },
    }));
  }

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    try {
      await delay(POLL_INTERVAL, options.signal);
      const result = await rhQueryTask(apiKey, taskId, options);
      options.onProgress?.(result.status, i + 1);

      if (result.status === 'SUCCESS') return result;
      if (result.status === 'FAILED') {
        throw new Error(
          withRunningHubDebug(`RunningHub task failed: ${result.errorMessage || 'Unknown error'}`, {
            ...debugContext,
            taskId,
            response: { ...result },
          }),
        );
      }
      // QUEUED or RUNNING — continue polling
    } catch (err) {
      // User abort: stop polling AND cancel the server task so it stops consuming quota.
      if (options.signal?.aborted) {
        await rhCancelTask(apiKey, taskId, { baseUrl: options.baseUrl });
        throw err;
      }
      // Query timeout: log and continue polling (server task may still be running fine).
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        console.warn('[RH Debug] rhQueryTask timeout, retrying next poll', { taskId, attempt: i + 1 });
        options.onProgress?.('RUNNING', i + 1);
        continue;
      }
      throw err;
    }
  }

  throw new Error(withRunningHubDebug('RunningHub task timed out after polling', {
    ...debugContext,
    taskId,
  }));
}

/** Quick test: verify API key validity */
export async function rhTestApiKey(apiKey: string, baseUrl?: string): Promise<boolean> {
  try {
    // Use a lightweight query with a dummy task ID to test auth
    const res = await fetch(`${rhBase(baseUrl)}/query`, {
      method: 'POST',
      headers: rhHeaders(apiKey),
      body: JSON.stringify({ taskId: '1234567890123456789' }),
    });
    // If auth fails, RunningHub may still return HTTP 200 with a business error code.
    // A missing dummy task means the key reached the API; auth codes/messages mean it did not.
    if (res.status === 401 || res.status === 403) return false;
    const json = await res.json().catch(() => null);
    const code = firstString(json?.errorCode, json?.code);
    const message = firstString(json?.errorMessage, json?.msg, json?.message);
    if (/^(401|403|802|806)$/i.test(code) || /api\s*key|apikey|unauthori[sz]ed|forbidden|permission|token|认证|鉴权|权限/i.test(message)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════
// RunningHub WebApp（AI 应用）API — 工作流编排接口
//
// 与上方 v2 标准模型 API 独立：
// - 认证方式不同（apiKey in body/query，非 Bearer header）
// - 基址不同（task/openapi + api/webapp，非 openapi/v2）
// - 交互模式不同（获取节点 → 修改参数 → 提交 → 轮询结果）
// ════════════════════════════════════════════════════════════════════

const RH_HOST = 'https://www.runninghub.cn';
const WEBAPP_POLL_INTERVAL = 5000; // 5s
const WEBAPP_MAX_POLL_ATTEMPTS = 120; // 10 min max

/** WebApp 节点信息 — 描述一个可修改的工作流节点 */
export interface RHWebAppNodeInfo {
  nodeId: string;
  nodeName: string;
  fieldName: string;
  fieldValue: string;
  fieldType: 'IMAGE' | 'AUDIO' | 'VIDEO' | 'STRING' | 'LIST';
  description: string;
  fieldData?: unknown; // LIST 类型时包含可选值列表
}

/** WebApp 提交响应 */
export interface RHWebAppSubmitResult {
  taskId: string;
  promptTips?: string; // JSON 字符串，包含 node_errors 等
}

/** WebApp 任务输出项 */
export interface RHWebAppOutputItem {
  fileUrl: string;
  fileType?: string;
  nodeId?: string;
}

/** WebApp 查询响应码含义 */
export type RHWebAppTaskStatus = 'SUCCESS' | 'RUNNING' | 'QUEUED' | 'FAILED' | 'UNKNOWN';

/**
 * 获取 WebApp 的可修改节点列表
 *
 * @param apiKey - RunningHub API Key
 * @param webappId - AI 应用 ID（WebApp 链接末尾数字）
 * @returns nodeInfoList — 所有可修改的节点
 */
export async function rhGetWebAppNodes(
  apiKey: string,
  webappId: string,
): Promise<RHWebAppNodeInfo[]> {
  // 注意：apiCallDemo 端点官方定义为 GET，apiKey 必须放在 query 中（端点限制）。
  // 额外附加 Authorization Bearer header 作为认证双保险（AI 应用接口支持）。
  const url = `${RH_HOST}/api/webapp/apiCallDemo?apiKey=${encodeURIComponent(apiKey)}&webappId=${encodeURIComponent(webappId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RunningHub WebApp 获取节点失败 (${res.status}): ${text || res.statusText}`);
  }

  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`RunningHub WebApp 错误: ${json.msg || JSON.stringify(json)}`);
  }

  return json.data?.nodeInfoList || [];
}

/**
 * 上传文件到 RunningHub（用于 IMAGE/AUDIO/VIDEO 类型节点）
 *
 * @param apiKey - RunningHub API Key
 * @param file - 要上传的文件
 * @returns 上传后的文件名（如 api/xxxx.jpg），用作 fieldValue
 */
export async function rhUploadWebAppFile(
  apiKey: string,
  file: File | Blob,
  fileName?: string,
): Promise<string> {
  const formData = new FormData();
  formData.append('apiKey', apiKey);
  formData.append('fileType', 'input');
  formData.append('file', file, fileName || 'upload.png');

  const res = await fetch(`${RH_HOST}/task/openapi/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RunningHub WebApp 文件上传失败 (${res.status}): ${text || res.statusText}`);
  }

  const json = await res.json();
  if (json.code !== 0 || !json.data?.fileName) {
    throw new Error(`RunningHub WebApp 上传错误: ${json.msg || '未返回 fileName'}`);
  }

  return json.data.fileName;
}

/**
 * 上传 data URL 图片到 WebApp
 */
export async function rhUploadWebAppDataUrl(
  apiKey: string,
  dataUrl: string,
): Promise<string> {
  const blob = dataUrlToBlob(dataUrl);
  const ext = blob.type.split('/')[1] || 'png';
  return rhUploadWebAppFile(apiKey, blob, `upload.${ext}`);
}

/**
 * 提交 WebApp 任务
 *
 * @param apiKey - RunningHub API Key
 * @param webappId - AI 应用 ID
 * @param nodeInfoList - 修改后的节点信息列表
 * @returns 包含 taskId 和 promptTips 的提交结果
 */
export async function rhSubmitWebAppTask(
  apiKey: string,
  webappId: string,
  nodeInfoList: RHWebAppNodeInfo[],
  signal?: AbortSignal,
): Promise<RHWebAppSubmitResult> {
  const res = await fetch(`${RH_HOST}/task/openapi/ai-app/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      webappId,
      apiKey,
      nodeInfoList,
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RunningHub WebApp 提交任务失败 (${res.status}): ${text || res.statusText}`);
  }

  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`RunningHub WebApp 提交错误: ${json.msg || JSON.stringify(json)}`);
  }

  const taskId = json.data?.taskId;
  if (!taskId) {
    throw new Error('RunningHub WebApp: 未返回 taskId');
  }

  // 检查 promptTips 中的 node_errors
  const promptTips = json.data?.promptTips;
  if (promptTips) {
    try {
      const tips = JSON.parse(promptTips);
      const nodeErrors = tips.node_errors;
      if (nodeErrors && Object.keys(nodeErrors).length > 0) {
        throw new Error(`RunningHub WebApp 节点错误: ${JSON.stringify(nodeErrors)}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('RunningHub WebApp 节点错误')) {
        throw e;
      }
      // promptTips 解析失败不阻塞
    }
  }

  return { taskId, promptTips };
}

/**
 * 查询 WebApp 任务输出（含状态判断）
 *
 * @returns status + outputs 数组（成功时）或 failedReason（失败时）
 */
export async function rhQueryWebAppOutputs(
  apiKey: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<{
  status: RHWebAppTaskStatus;
  outputs: RHWebAppOutputItem[];
  failedReason?: string;
}> {
  const res = await fetch(`${RH_HOST}/task/openapi/outputs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ apiKey, taskId }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RunningHub WebApp 查询失败 (${res.status}): ${text || res.statusText}`);
  }

  const json = await res.json();
  const code = json.code;

  // code=0 → 成功，data 是输出数组
  if (code === 0 && Array.isArray(json.data)) {
    return {
      status: 'SUCCESS',
      outputs: json.data.map((item: Record<string, unknown>) => ({
        fileUrl: item.fileUrl || '',
        fileType: item.fileType,
        nodeId: item.nodeId,
      })),
    };
  }

  // code=805 → 失败
  if (code === 805) {
    const reason = json.data?.failedReason;
    return {
      status: 'FAILED',
      outputs: [],
      failedReason: reason
        ? `${reason.node_name}: ${reason.exception_message}`
        : json.msg || '任务失败',
    };
  }

  // code=804 → 运行中, code=813 → 排队中
  if (code === 804) return { status: 'RUNNING', outputs: [] };
  if (code === 813) return { status: 'QUEUED', outputs: [] };

  // 其余非 0 code（含 802 认证错误、811 等）视为失败，避免静默 UNKNOWN
  return {
    status: 'FAILED',
    outputs: [],
    failedReason: json.msg || `RunningHub 错误码 ${code}`,
  };
}

/**
 * 运行完整的 WebApp 工作流 — 提交任务 + 自动轮询直到完成
 *
 * @param apiKey - RunningHub API Key
 * @param webappId - AI 应用 ID
 * @param nodeInfoList - 修改后的节点信息列表
 * @param onProgress - 进度回调（状态, 轮询次数）
 * @returns 最终输出项数组
 */
export async function rhRunWebApp(
  apiKey: string,
  webappId: string,
  nodeInfoList: RHWebAppNodeInfo[],
  onProgress?: (status: RHWebAppTaskStatus, attempt: number) => void,
  signal?: AbortSignal,
): Promise<RHWebAppOutputItem[]> {
  const { taskId } = await rhSubmitWebAppTask(apiKey, webappId, nodeInfoList, signal);

  for (let i = 0; i < WEBAPP_MAX_POLL_ATTEMPTS; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    // abortible sleep：signal abort 时提前结束等待
    await new Promise<void>((resolve) => {
      if (signal?.aborted) { resolve(); return; }
      const timer = setTimeout(resolve, WEBAPP_POLL_INTERVAL);
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const result = await rhQueryWebAppOutputs(apiKey, taskId, signal);
    onProgress?.(result.status, i + 1);

    if (result.status === 'SUCCESS') return result.outputs;
    if (result.status === 'FAILED') {
      throw new Error(`RunningHub WebApp 任务失败: ${result.failedReason || '未知错误'}`);
    }
    // QUEUED / RUNNING → 继续轮询
  }

  throw new Error('RunningHub WebApp 任务超时（超过 10 分钟）');
}

/** 快速验证 WebApp API Key（尝试用一个随机 webappId 获取节点） */
export async function rhTestWebAppApiKey(apiKey: string): Promise<boolean> {
  try {
    // 用 dummy webappId 请求，如果 key 错误会返回非 0 code
    const url = `${RH_HOST}/api/webapp/apiCallDemo?apiKey=${encodeURIComponent(apiKey)}&webappId=test-0000`;
    const res = await fetch(url);
    // 401/403 → 无效 key
    return res.status !== 401 && res.status !== 403;
  } catch {
    return false;
  }
}
