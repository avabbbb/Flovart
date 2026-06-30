import type { CameraMovement, StylePreset, WorkflowNode, WorkflowNodeMetadata, WorkflowNodeType, WorkflowPoint } from './types';

export const WORKFLOW_NODE_SPECS: Record<WorkflowNodeType, { title: string; width: number; height: number; metadata: WorkflowNodeMetadata }> = {
  image: { title: '图片', width: 340, height: 240, metadata: { status: 'idle' } },
  text: { title: '文本', width: 340, height: 220, metadata: { content: '', status: 'idle' } },
  video: { title: '视频', width: 420, height: 236, metadata: { status: 'idle' } },
  audio: { title: '音频', width: 340, height: 120, metadata: { status: 'idle' } },
  config: {
    title: '生成配置',
    width: 360,
    height: 260,
    metadata: { prompt: '', status: 'idle', config: { mode: 'image' } },
  },
  script: {
    title: '脚本',
    width: 480,
    height: 560,
    metadata: { status: 'idle', scriptBreakdown: { assets: [], shots: [] } },
  },
};

export const INITIAL_WORKFLOW_VIEWPORT = { x: 0, y: 0, k: 1 } as const;

export function createWorkflowNode(id: string, type: WorkflowNodeType, position: WorkflowPoint, metadata: WorkflowNodeMetadata = {}): WorkflowNode {
  const spec = WORKFLOW_NODE_SPECS[type];
  return {
    id,
    type,
    title: spec.title,
    position,
    width: spec.width,
    height: spec.height,
    isVisible: true,
    isLocked: false,
    metadata: { ...spec.metadata, ...metadata },
  };
}

export const CAMERA_MOVEMENTS: CameraMovement[] = [
  { id: 'push', name: '推进', description: '镜头向主体推进', promptKeyword: 'camera push in' },
  { id: 'pull', name: '拉远', description: '镜头远离主体', promptKeyword: 'camera pull out' },
  { id: 'pan', name: '平移', description: '水平移动', promptKeyword: 'camera pan' },
  { id: 'tilt', name: '俯仰', description: '垂直俯仰', promptKeyword: 'camera tilt' },
  { id: 'dolly', name: '移动', description: '跟拍移动', promptKeyword: 'camera dolly' },
  { id: 'orbit', name: '环绕', description: '环绕主体', promptKeyword: 'camera orbit' },
  { id: 'crane', name: '升降', description: '垂直升降', promptKeyword: 'camera crane' },
  { id: 'handheld', name: '手持', description: '手持晃动', promptKeyword: 'handheld camera' },
  { id: 'static', name: '固定', description: '固定机位', promptKeyword: 'static camera' },
  { id: 'zoom-in', name: '变焦推进', description: '光学变焦放大', promptKeyword: 'zoom in' },
  { id: 'zoom-out', name: '变焦拉远', description: '光学变焦缩小', promptKeyword: 'zoom out' },
  { id: 'whip-pan', name: '甩镜头', description: '快速平移', promptKeyword: 'whip pan' },
  { id: 'dutch', name: '荷兰角', description: '倾斜构图', promptKeyword: 'dutch angle' },
  { id: 'fpv', name: '第一人称', description: 'FPV穿越', promptKeyword: 'FPV drone' },
  { id: 'aerial', name: '航拍', description: '空中俯拍', promptKeyword: 'aerial shot' },
  { id: 'tracking', name: '跟随', description: '跟拍主体', promptKeyword: 'tracking shot' },
  { id: 'establishing', name: '建立镜头', description: '全景建立', promptKeyword: 'establishing shot' },
  { id: 'close-up', name: '特写', description: '近景特写', promptKeyword: 'close-up shot' },
  { id: 'over-shoulder', name: '过肩', description: '过肩镜头', promptKeyword: 'over the shoulder' },
  { id: 'low-angle', name: '仰拍', description: '低角度仰视', promptKeyword: 'low angle shot' },
  { id: 'high-angle', name: '俯拍', description: '高角度俯视', promptKeyword: 'high angle shot' },
];

export const CAMERA_OPTIONS = {
  cameras: ['Sony Venice', 'ARRI Alexa', 'RED Komodo', 'Canon EOS R5', 'Panasonic GH6', 'Blackmagic'],
  lenses: ['广角', '标准', '长焦', '微距', 'Helios 44', 'Anamorphic'],
  focalLengths: ['24mm', '35mm', '50mm', '85mm', '135mm'],
  apertures: ['f/1.8', 'f/2.8', 'f/4', 'f/5.6', 'f/8'],
};

export const STYLE_PRESETS: StylePreset[] = [
  { id: 'anime', name: '动漫', category: '插画', promptPrefix: 'anime style, cel shading, vibrant colors, clean lines' },
  { id: 'realistic', name: '写实', category: '摄影', promptPrefix: 'photorealistic, 8k, detailed, natural lighting' },
  { id: 'oil', name: '油画', category: '艺术', promptPrefix: 'oil painting, textured brushstrokes, rich colors' },
  { id: 'watercolor', name: '水彩', category: '艺术', promptPrefix: 'watercolor painting, soft edges, translucent' },
  { id: 'cyberpunk', name: '赛博朋克', category: '科幻', promptPrefix: 'cyberpunk, neon lights, dystopian, high contrast' },
  { id: 'studio-ghibli', name: '吉卜力', category: '插画', promptPrefix: 'Studio Ghibli style, soft colors, hand-drawn' },
  { id: 'comic', name: '美漫', category: '插画', promptPrefix: 'comic book style, bold outlines, halftone shading' },
  { id: 'pixel-art', name: '像素画', category: '插画', promptPrefix: 'pixel art, 16-bit, retro game style' },
  { id: '3d-render', name: '3D渲染', category: '3D', promptPrefix: '3D render, octane render, ray tracing, volumetric light' },
  { id: 'low-poly', name: '低多边形', category: '3D', promptPrefix: 'low poly, flat shading, geometric' },
  { id: 'isometric', name: '等距', category: '3D', promptPrefix: 'isometric view, clean geometry' },
  { id: 'noir', name: '黑白电影', category: '摄影', promptPrefix: 'film noir, black and white, high contrast, dramatic shadows' },
  { id: 'vintage', name: '复古', category: '摄影', promptPrefix: 'vintage film, grain, faded colors, nostalgic' },
  { id: 'portrait', name: '人像', category: '摄影', promptPrefix: 'professional portrait, bokeh, studio lighting' },
  { id: 'landscape', name: '风景', category: '摄影', promptPrefix: 'landscape photography, golden hour, wide angle' },
  { id: 'concept-art', name: '概念艺术', category: '艺术', promptPrefix: 'concept art, digital painting, matte painting' },
  { id: 'water-ink', name: '水墨', category: '艺术', promptPrefix: 'Chinese ink painting, sumi-e, minimalistic' },
  { id: 'pop-art', name: '波普艺术', category: '艺术', promptPrefix: 'pop art, bold colors, Andy Warhol style' },
  { id: 'gothic', name: '哥特', category: '艺术', promptPrefix: 'gothic, dark atmosphere, ornate details, moody' },
  { id: 'flat-design', name: '扁平设计', category: '设计', promptPrefix: 'flat design, minimal, vector style' },
  { id: 'uxiang', name: '国风', category: '艺术', promptPrefix: 'Chinese traditional style, guofeng, elegant' },
  { id: 'claymation', name: '黏土动画', category: '3D', promptPrefix: 'claymation, stop motion, clay texture' },
];
