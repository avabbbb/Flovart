import type { WorkflowProject } from '../workflow/types';

export const COMMUNITY_CATEGORIES = ['全部', 'TV Show', '人物', '风景', '产品', '动漫', '抽象'] as const;
export type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number];

export interface CommunityWorkflow {
  id: string;
  title: string;
  description?: string;
  thumbUrls: string[];
  coverVideoUrl?: string;
  gradient: string;
  author: { name: string; avatar?: string };
  likes: number;
  views: number;
  forks: number;
  category: Exclude<CommunityCategory, '全部'>;
  tags: string[];
  workflowJson: WorkflowProject;
  createdAt: string;
}

const NOW = Date.UTC(2026, 6, 12);
const iso = (offsetMs: number) => new Date(NOW - offsetMs).toISOString();

function makeWorkflow(
  title: string,
  prompts: Array<{ type: 'text' | 'image'; prompt: string; x: number; y: number }>,
): WorkflowProject {
  const nodeBase = (i: number) => ({
    id: `mock-node-${title}-${i}`,
    title: `节点 ${i + 1}`,
    position: { x: 120 + i * 260, y: 140 },
    width: 240,
    height: 160,
    metadata: {} as any,
  });
  const nodes = prompts.map((p, i) => ({
    ...nodeBase(i),
    type: p.type,
    title: p.type === 'text' ? '文本' : '图片',
    metadata: { prompt: p.prompt, position: { x: p.x, y: p.y } } as any,
    position: { x: p.x, y: p.y },
  }));
  const connections = prompts.length > 1
    ? prompts.slice(1).map((_, i) => ({
        id: `mock-conn-${title}-${i}`,
        fromNodeId: nodes[i].id,
        toNodeId: nodes[i + 1].id,
      }))
    : [];
  return {
    id: `mock-proj-${title}`,
    title,
    nodes,
    connections,
    selectedNodeIds: [],
    viewport: { x: 0, y: 0, k: 1 },
    backgroundMode: 'dots',
    agentSessions: [],
    activeAgentSessionId: null,
    createdAt: iso(0),
    updatedAt: iso(0),
  };
}

export const COMMUNITY_WORKFLOWS: CommunityWorkflow[] = [
  {
    id: 'cw1',
    title: '赛博废土武侠短片',
    description: '霓虹+水墨的赛博武侠分镜工作流，6 分镜一键生成',
    thumbUrls: [],
    gradient: 'linear-gradient(135deg, #1a1a2e 0%, #e94560 100%)',
    author: { name: '阿浪' },
    likes: 1240,
    views: 5230,
    forks: 86,
    category: 'TV Show',
    tags: ['赛博', '武侠', '分镜'],
    workflowJson: makeWorkflow('赛博废土武侠', [
      { type: 'text', prompt: '赛博武侠短片脚本，6 个分镜，霓虹+水墨混合风格', x: 80, y: 120 },
      { type: 'image', prompt: '霓虹街道特写，赛博武士背影，水墨笔触，雨夜', x: 380, y: 120 },
    ]),
    createdAt: iso(1000 * 60 * 60 * 24),
  },
  {
    id: 'cw2',
    title: '花园精灵角色迭代',
    description: '从文字描述到角色 4 视图，连贯生成一组精灵造型',
    thumbUrls: [],
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    author: { name: '小树' },
    likes: 856,
    views: 3120,
    forks: 51,
    category: '人物',
    tags: ['精灵', '角色', '4 视图'],
    workflowJson: makeWorkflow('花园精灵', [
      { type: 'text', prompt: '花园精灵角色设定：花瓣裙、透明翅膀、手绘水彩风', x: 80, y: 120 },
      { type: 'image', prompt: '花园精灵正面 4 视图，花瓣裙，透明翅膀，水彩手绘', x: 380, y: 120 },
    ]),
    createdAt: iso(1000 * 60 * 60 * 48),
  },
  {
    id: 'cw3',
    title: '深海探秘 TV Show',
    description: '深海生物纪录短片工作流，每集 3 镜',
    thumbUrls: [],
    gradient: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
    author: { name: 'JIOJIO' },
    likes: 2103,
    views: 8800,
    forks: 142,
    category: 'TV Show',
    tags: ['深海', '纪录', '短片'],
    workflowJson: makeWorkflow('深海之旅', [
      { type: 'text', prompt: '深海探秘纪录片脚本：第 1 集，3 个分镜', x: 80, y: 120 },
      { type: 'image', prompt: '深海发光水母近景，黑暗水域，生物冷光', x: 380, y: 120 },
    ]),
    createdAt: iso(1000 * 60 * 60 * 72),
  },
  {
    id: 'cw4',
    title: '极简产品广告',
    description: '纯白背景产品旋转展示，适合电商主图',
    thumbUrls: [],
    gradient: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
    author: { name: 'Dave' },
    likes: 432,
    views: 1980,
    forks: 24,
    category: '产品',
    tags: ['极简', '电商', '广告'],
    workflowJson: makeWorkflow('极简产品', [
      { type: 'text', prompt: '极简白底产品镜头，柔和阴影，旋转展示', x: 80, y: 120 },
      { type: 'image', prompt: '产品广告镜头，旋转展示，柔光箱打光，纯色背景', x: 380, y: 120 },
    ]),
    createdAt: iso(1000 * 60 * 60 * 96),
  },
  {
    id: 'cw5',
    title: '国风短片：山水赋',
    description: '宋代山水意境+水墨运镜+古风配乐',
    thumbUrls: [],
    gradient: 'linear-gradient(135deg, #8e2de2 0%, #4a00e0 100%)',
    author: { name: '生白' },
    likes: 1789,
    views: 6400,
    forks: 98,
    category: 'TV Show',
    tags: ['国风', '水墨', '短片'],
    workflowJson: makeWorkflow('国风短片', [
      { type: 'text', prompt: '宋代山水意境短片，远山近水，云雾缭绕，水墨运镜', x: 80, y: 120 },
      { type: 'image', prompt: '中国山水画远景，云雾缭绕，宋代意境', x: 380, y: 120 },
    ]),
    createdAt: iso(1000 * 60 * 60 * 120),
  },
  {
    id: 'cw6',
    title: '动漫角色设计集',
    description: '新海诚风格少女角色，樱花校园背景',
    thumbUrls: [],
    gradient: 'linear-gradient(135deg, #ff6a88 0%, #ff99ac 100%)',
    author: { name: 'Berry' },
    likes: 2890,
    views: 11000,
    forks: 203,
    category: '动漫',
    tags: ['新海诚', '少女', '樱花'],
    workflowJson: makeWorkflow('动漫角色', [
      { type: 'text', prompt: '日系动漫少女角色，赛璐璐上色，新海诚风格', x: 80, y: 120 },
      { type: 'image', prompt: '日系动漫少女，校园制服，樱花背景，新海诚光线', x: 380, y: 120 },
    ]),
    createdAt: iso(1000 * 60 * 60 * 144),
  },
  {
    id: 'cw7',
    title: '赛博城市夜行',
    description: '霓虹街道+雨夜+赛博朋克氛围，4 镜头',
    thumbUrls: [],
    gradient: 'linear-gradient(135deg, #0f0c29 0%, #302b63 100%)',
    author: { name: 'YOUNG' },
    likes: 1543,
    views: 7200,
    forks: 77,
    category: '风景',
    tags: ['赛博', '夜景', '霓虹'],
    workflowJson: makeWorkflow('赛博城市', [
      { type: 'text', prompt: '赛博朋克城市夜行脚本，4 镜头', x: 80, y: 120 },
      { type: 'image', prompt: '霓虹城市夜景，雨天，赛博朋克氛围，电影运镜', x: 380, y: 120 },
    ]),
    createdAt: iso(1000 * 60 * 60 * 168),
  },
  {
    id: 'cw8',
    title: '极简建筑摄影',
    description: '几何形态+对比阴影，建筑摄影板',
    thumbUrls: [],
    gradient: 'linear-gradient(135deg, #d3cce3 0%, #e9e4f0 100%)',
    author: { name: '青木' },
    likes: 621,
    views: 2400,
    forks: 18,
    category: '风景',
    tags: ['建筑', '极简', '光影'],
    workflowJson: makeWorkflow('极简建筑', [
      { type: 'text', prompt: '极简建筑摄影，几何形态，强烈阴影对比', x: 80, y: 120 },
      { type: 'image', prompt: '极简建筑立面，几何构图，强光影对比', x: 380, y: 120 },
    ]),
    createdAt: iso(1000 * 60 * 60 * 192),
  },
  {
    id: 'cw9',
    title: '电影质感人像',
    description: '柔和侧光+浅景深，电影感人像工作流',
    thumbUrls: [],
    gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    author: { name: '阿浪' },
    likes: 1980,
    views: 5600,
    forks: 113,
    category: '人物',
    tags: ['电影', '人像', '侧光'],
    workflowJson: makeWorkflow('电影人像', [
      { type: 'text', prompt: '电影质感人像，柔和侧光，浅景深', x: 80, y: 120 },
      { type: 'image', prompt: '电影质感特写，柔和侧光，浅景深，女性肖像，自然皮肤纹理，温暖色调', x: 380, y: 120 },
    ]),
    createdAt: iso(1000 * 60 * 60 * 216),
  },
  {
    id: 'cw10',
    title: '产品广告大片·旋转',
    description: '高端商业质感，旋转展示+柔光箱',
    thumbUrls: [],
    gradient: 'linear-gradient(135deg, #232526 0%, #414345 100%)',
    author: { name: 'Dave' },
    likes: 740,
    views: 2900,
    forks: 31,
    category: '产品',
    tags: ['广告', '商业', '旋转'],
    workflowJson: makeWorkflow('产品广告大片', [
      { type: 'text', prompt: '高端商业产品广告，旋转展示', x: 80, y: 120 },
      { type: 'image', prompt: '产品广告镜头，旋转展示，柔光箱打光，纯色背景，高端商业质感', x: 380, y: 120 },
    ]),
    createdAt: iso(1000 * 60 * 60 * 240),
  },
  {
    id: 'cw11',
    title: '抽象情绪短片',
    description: '色彩流动+粒子+几何，氛围向',
    thumbUrls: [],
    gradient: 'linear-gradient(135deg, #fc5c7d 0%, #6a82fb 100%)',
    author: { name: '小树' },
    likes: 980,
    views: 3300,
    forks: 22,
    category: '抽象',
    tags: ['抽象', '粒子', '氛围'],
    workflowJson: makeWorkflow('抽象情绪', [
      { type: 'text', prompt: '抽象情绪短片，色彩流动，粒子几何', x: 80, y: 120 },
      { type: 'image', prompt: '抽象色彩流动，粒子几何，氛围画面', x: 380, y: 120 },
    ]),
    createdAt: iso(1000 * 60 * 60 * 260),
  },
  {
    id: 'cw12',
    title: '山水写意·宋代意境',
    description: '中国传统水墨山水，写意笔触',
    thumbUrls: [],
    gradient: 'linear-gradient(135deg, #485563 0%, #29323c 100%)',
    author: { name: '生白' },
    likes: 1340,
    views: 4900,
    forks: 62,
    category: '风景',
    tags: ['水墨', '山水', '写意'],
    workflowJson: makeWorkflow('山水写意', [
      { type: 'text', prompt: '中国传统山水画，水墨写意，远山近水', x: 80, y: 120 },
      { type: 'image', prompt: '中国传统山水画，水墨写意，远山近水，云雾缭绕，宋代山水意境', x: 380, y: 120 },
    ]),
    createdAt: iso(1000 * 60 * 60 * 280),
  },
];

export const BANNER_WORKFLOWS = COMMUNITY_WORKFLOWS.slice(0, 6);