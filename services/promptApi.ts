// 提示词生态 API
import { api, HUB_BASE_URL } from './hubClient';

export interface PromptItem {
  id?: string;
  name: string;
  prompt: string;
  sort?: number;
}

export interface PromptPack {
  id: string;
  slug: string;
  title: string;
  description?: string;
  authorId: string;
  author?: { id: string; username: string; avatarUrl?: string };
  mode: 'image' | 'video' | 'text';
  tags?: string[];
  items: PromptItem[];
  likeCount: number;
  downloadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  size: number;
}

export interface ListPromptsParams {
  keyword?: string;
  mode?: 'image' | 'video' | 'text';
  authorId?: string;
  sort?: 'latest' | 'popular' | 'downloads';
  page?: number;
  size?: number;
  tags?: string[];
}

function buildQuery(params: ListPromptsParams): string {
  const u = new URLSearchParams();
  if (params.keyword) u.set('keyword', params.keyword);
  if (params.mode) u.set('mode', params.mode);
  if (params.authorId) u.set('authorId', params.authorId);
  if (params.sort) u.set('sort', params.sort);
  if (params.page) u.set('page', String(params.page));
  if (params.size) u.set('size', String(params.size));
  params.tags?.forEach((t) => u.append('tags', t));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const promptApi = {
  list: (params: ListPromptsParams) =>
    api.get<PageResult<PromptPack>>(HUB_BASE_URL, `/prompts${buildQuery(params)}`),
  get: (id: string) => api.get<PromptPack>(HUB_BASE_URL, `/prompts/${id}`),
  getBySlug: (slug: string) => api.get<PromptPack>(HUB_BASE_URL, `/prompts/by-slug/${slug}`),
  download: (id: string) => api.get<PromptPack>(HUB_BASE_URL, `/prompts/${id}/download`),
  create: (body: {
    slug: string;
    title: string;
    description?: string;
    mode: 'image' | 'video' | 'text';
    tags?: string[];
    items: PromptItem[];
  }) => api.post<PromptPack>(HUB_BASE_URL, '/prompts', body),
  update: (id: string, body: Parameters<typeof promptApi.create>[1]) =>
    api.put<PromptPack>(HUB_BASE_URL, `/prompts/${id}`, body),
  remove: (id: string) => api.del<{ deleted: string }>(HUB_BASE_URL, `/prompts/${id}`),
  toggleLike: (id: string) => api.post<{ liked: boolean }>(HUB_BASE_URL, `/prompts/${id}/like`),
};