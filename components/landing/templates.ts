export interface LandingTemplate {
  id: string;
  title: string;
  category: TemplateCategory;
  prompt: string;
  model: string;
  type: 'image' | 'video' | 'workflow';
  gradient: string;
  badge?: string;
}

export type TemplateCategory = '全部' | '人物' | '风景' | '产品' | '动漫' | '视频';

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['全部', '人物', '风景', '产品', '动漫', '视频'];

export const LANDING_TEMPLATES: LandingTemplate[] = [
  {
    id: 'portrait-cinematic',
    title: '电影质感人像',
    category: '人物',
    prompt: '电影质感特写，柔和侧光，浅景深，女性肖像，自然皮肤纹理，温暖色调',
    model: 'Seedream 4.5',
    type: 'image',
    gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    badge: '热门',
  },
  {
    id: 'landscape-fantasy',
    title: '奇幻风景',
    category: '风景',
    prompt: '史诗级奇幻风景，悬浮岛屿，瀑布云海，黄金时刻光线，超写实细节',
    model: 'Flux Pro',
    type: 'image',
    gradient: 'linear-gradient(135deg, #2d1b69 0%, #11998e 50%, #38ef7d 100%)',
  },
  {
    id: 'product-minimal',
    title: '极简产品展示',
    category: '产品',
    prompt: '极简风格产品摄影，纯白背景，柔和阴影，高级感，苹果风格',
    model: 'Nano Banana',
    type: 'image',
    gradient: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
  },
  {
    id: 'anime-character',
    title: '动漫角色设计',
    category: '动漫',
    prompt: '日系动漫风格，赛璐璐上色，少女角色，校园制服，樱花背景，新海诚风格',
    model: 'Seedream 4.5',
    type: 'image',
    gradient: 'linear-gradient(135deg, #ff6a88 0%, #ff99ac 50%, #fad0c4 100%)',
    badge: '热门',
  },
  {
    id: 'video-cinematic',
    title: '电影感视频生成',
    category: '视频',
    prompt: '电影运镜，缓慢推进，城市夜景，霓虹灯光，雨天，赛博朋克氛围',
    model: 'Seedance 2.0',
    type: 'video',
    gradient: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
    badge: '视频',
  },
  {
    id: 'video-product-ad',
    title: '产品广告视频',
    category: '视频',
    prompt: '产品广告镜头，旋转展示，柔光箱打光，纯色背景，高端商业质感',
    model: 'Kling 2.0',
    type: 'video',
    gradient: 'linear-gradient(135deg, #232526 0%, #414345 100%)',
    badge: '视频',
  },
  {
    id: 'portrait-ink',
    title: '水墨人像',
    category: '人物',
    prompt: '中国水墨画风格，留白意境，人物侧影，毛笔笔触，宣纸纹理',
    model: 'Flux Pro',
    type: 'image',
    gradient: 'linear-gradient(135deg, #2c3e50 0%, #4ca1af 100%)',
  },
  {
    id: 'landscape-ink',
    title: '山水写意',
    category: '风景',
    prompt: '中国传统山水画，水墨写意，远山近水，云雾缭绕，宋代山水意境',
    model: 'Seedream 4.5',
    type: 'image',
    gradient: 'linear-gradient(135deg, #485563 0%, #29323c 100%)',
  },
];

export interface ShowcaseWork {
  id: string;
  title: string;
  author: string;
  gradient: string;
  type: 'image' | 'video';
}

export const SHOWCASE_WORKS: ShowcaseWork[] = [
  { id: 'sw1', title: '赛博废土武侠', author: '阿浪', gradient: 'linear-gradient(135deg, #1a1a2e 0%, #e94560 100%)', type: 'video' },
  { id: 'sw2', title: '花园精灵', author: '小树', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', type: 'image' },
  { id: 'sw3', title: '深海之旅', author: 'JIOJIO', gradient: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)', type: 'video' },
  { id: 'sw4', title: '产品广告大片', author: 'Dave', gradient: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)', type: 'image' },
  { id: 'sw5', title: '国风短片', author: '生白', gradient: 'linear-gradient(135deg, #8e2de2 0%, #4a00e0 100%)', type: 'video' },
  { id: 'sw6', title: '动漫角色', author: 'Berry', gradient: 'linear-gradient(135deg, #ff6a88 0%, #ff99ac 100%)', type: 'image' },
  { id: 'sw7', title: '赛博城市', author: 'YOUNG', gradient: 'linear-gradient(135deg, #0f0c29 0%, #302b63 100%)', type: 'video' },
  { id: 'sw8', title: '极简建筑', author: '青木', gradient: 'linear-gradient(135deg, #d3cce3 0%, #e9e4f0 100%)', type: 'image' },
];
