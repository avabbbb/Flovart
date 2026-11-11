import { nanoid } from 'nanoid';
import { createWorkflowNode } from './constants';
import type { WorkflowConnection, WorkflowNode } from './types';

export type WorkflowTemplateId = 'text-to-image' | 'reference-edit' | 'storyboard-video' | 'product-scene';

type Localized = { zho: string; eng: string };

export interface WorkflowTemplate {
  id: WorkflowTemplateId;
  title: Localized;
  description: Localized;
  samplePrompt: Localized;
  keywords: readonly string[];
}

export interface WorkflowTemplateSeed {
  templateId: WorkflowTemplateId;
  title: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: 'text-to-image',
    title: { zho: '一句话出图', eng: 'Text to image' },
    description: { zho: '提示词 → 图片', eng: 'Prompt → image' },
    samplePrompt: { zho: '雨夜霓虹街头的赛博朋克猫，电影感海报', eng: 'A cyberpunk cat on a rainy neon street, cinematic poster' },
    keywords: [],
  },
  {
    id: 'reference-edit',
    title: { zho: '参考图改图', eng: 'Edit a reference' },
    description: { zho: '参考图 → 改图结果', eng: 'Reference → edited image' },
    samplePrompt: { zho: '保持人物不变，换成秋天的公园背景', eng: 'Keep the subject, switch to an autumn park background' },
    keywords: ['参考', '改图', '换背景', '修改', '这张图', 'reference', 'edit', 'restyle'],
  },
  {
    id: 'storyboard-video',
    title: { zho: '故事到视频', eng: 'Story to video' },
    description: { zho: '故事 → 关键帧 → 视频', eng: 'Story → keyframe → video' },
    samplePrompt: { zho: '清晨的海边，一个女孩追着风筝奔跑', eng: 'A girl chasing a kite on the beach at dawn' },
    keywords: ['视频', '分镜', '镜头', '短片', '动画', 'video', 'storyboard', 'shot', 'clip', 'animate'],
  },
  {
    id: 'product-scene',
    title: { zho: '产品换场景', eng: 'Product in scene' },
    description: { zho: '产品图 → 场景图 → 展示视频', eng: 'Product → scene → showcase video' },
    samplePrompt: { zho: '放在大理石台面上，柔和晨光，高级感', eng: 'On a marble counter, soft morning light, premium feel' },
    keywords: ['产品', '商品', '电商', '主图', '包装', 'product', 'packshot', 'ecommerce'],
  },
];

const ORIGIN = { x: 80, y: 120 };
const GAP = 120;

function place(type: WorkflowNode['type'], after: WorkflowNode | null, title: string, metadata: WorkflowNode['metadata'] = {}): WorkflowNode {
  const position = after ? { x: after.position.x + after.width + GAP, y: ORIGIN.y } : { ...ORIGIN };
  return { ...createWorkflowNode(nanoid(), type, position, metadata), title };
}

function chain(nodes: WorkflowNode[]): WorkflowConnection[] {
  const result: WorkflowConnection[] = [];
  for (let index = 1; index < nodes.length; index += 1) {
    const from = nodes.at(index - 1) as WorkflowNode;
    const to = nodes.at(index) as WorkflowNode;
    result.push({ id: nanoid(), fromNodeId: from.id, toNodeId: to.id, kind: 'data', order: 0 });
  }
  return result;
}

// 没有 AI Key 时的一句话起步：按关键词挑模板，默认一句话出图。
export function matchWorkflowTemplate(prompt: string): WorkflowTemplateId {
  const text = prompt.toLowerCase();
  const order: WorkflowTemplateId[] = ['product-scene', 'storyboard-video', 'reference-edit'];
  for (const id of order) {
    const template = WORKFLOW_TEMPLATES.find(item => item.id === id);
    if (template && template.keywords.some(keyword => text.includes(keyword))) return id;
  }
  return 'text-to-image';
}

// 只搭节点和连线，不自动运行；生成仍由用户在节点上确认。
export function buildWorkflowTemplate(id: WorkflowTemplateId, prompt: string, language: string): WorkflowTemplateSeed {
  const zh = language === 'zho';
  const template = WORKFLOW_TEMPLATES.find(item => item.id === id) || (WORKFLOW_TEMPLATES.at(0) as WorkflowTemplate);
  const text = prompt.trim() || (zh ? template.samplePrompt.zho : template.samplePrompt.eng);
  const title = text.length > 24 ? text.slice(0, 24) + '…' : text;
  let nodes: WorkflowNode[];
  if (template.id === 'reference-edit') {
    const reference = place('image', null, zh ? '参考图（拖入或上传）' : 'Reference (drop or upload)');
    const result = place('image', reference, zh ? '改图结果' : 'Edited image', { prompt: text, config: { mode: 'image', preserveReferenceAspectRatio: true } });
    nodes = [reference, result];
  } else if (template.id === 'storyboard-video') {
    const story = place('text', null, zh ? '故事备注' : 'Story note', { content: text });
    const keyframe = place('image', story, zh ? '关键帧' : 'Keyframe', { prompt: text, config: { mode: 'image', aspectRatio: '16:9' } });
    const video = place('video', keyframe, zh ? '视频' : 'Video', { prompt: text, config: { mode: 'video', aspectRatio: '16:9', durationSec: 5 } });
    nodes = [story, keyframe, video];
  } else if (template.id === 'product-scene') {
    const product = place('image', null, zh ? '产品图（拖入或上传）' : 'Product (drop or upload)');
    const scene = place('image', product, zh ? '场景图' : 'Scene', { prompt: zh ? '保持产品外观不变，' + text : 'Keep the product unchanged. ' + text, config: { mode: 'image', preserveReferenceAspectRatio: true } });
    const showcase = place('video', scene, zh ? '展示视频' : 'Showcase video', { prompt: zh ? '产品展示镜头，缓慢环绕，' + text : 'Slow orbit product showcase. ' + text, config: { mode: 'video', durationSec: 5 } });
    nodes = [product, scene, showcase];
  } else {
    const image = place('image', null, zh ? '图片' : 'Image', { prompt: text, config: { mode: 'image', aspectRatio: '1:1' } });
    nodes = [image];
  }
  return { templateId: template.id, title, nodes, connections: template.id === 'storyboard-video' ? chain(nodes.slice(1)) : chain(nodes) };
}

// 示例画布：明确标注为示例，浏览和编辑不需要 Key；运行时仍走计划卡与配置引导。
export function buildSampleCanvasSeed(language: string): Omit<WorkflowTemplateSeed, 'templateId'> {
  const zh = language === 'zho';
  const script = place('text', null, zh ? '示例 · 脚本' : 'Sample · Script', {
    content: zh
      ? '【示例】三镜头产品短片。浏览、编辑、连线都不需要 Key；运行镜头前需先在设置中配置自己的 AI 服务。'
      : '[Sample] A three-shot product clip. Browsing, editing and connecting need no key; running a shot needs your own AI service in Settings.',
  });
  const prompts = zh
    ? ['产品全景，镜头缓慢推进，柔光', '产品特写，侧光扫过材质', '产品落幅，镜头拉远，留白放标题']
    : ['Product wide shot, slow push-in, soft light', 'Product close-up, side light across the surface', 'End card, pull back, space for a title'];
  const shots: WorkflowNode[] = [];
  prompts.forEach((prompt, index) => {
    const shot = place('video', shots.at(-1) || script, (zh ? '示例 · 镜头 ' : 'Sample · Shot ') + (index + 1), { prompt, config: { mode: 'video', aspectRatio: '16:9', durationSec: 5 } });
    shots.push(shot);
  });
  const connections: WorkflowConnection[] = [];
  return { title: zh ? '示例 · 三镜头产品短片' : 'Sample · Three-shot product clip', nodes: [script, ...shots], connections };
}

// 由模板或示例新建、尚未适配视图的画布 id；画布首次测量到尺寸时适配一次后移除。
export const workflowFitOnOpen = new Set<string>();
