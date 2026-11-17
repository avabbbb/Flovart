// 提示词包数据结构：本地 / 内置提示词库与导入导出共用。
// 原 Go Hub 的 /prompts 接口已移除（网页版全静态），提示词只存在本机。

export interface PromptItem {
  id?: string;
  name: string;
  prompt: string;
  sort?: number;
  tags?: string[];
  modality?: 'text' | 'image' | 'video' | 'audio' | 'mixed';
  modelHints?: string[];
  requiredReferenceRoles?: string[];
  optionalReferenceRoles?: string[];
  examples?: Array<{ title?: string; text: string }>;
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
