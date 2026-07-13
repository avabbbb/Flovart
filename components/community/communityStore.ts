import localforage from 'localforage';
import { nanoid } from 'nanoid';
import type { WorkflowProject } from '../workflow/types';
import { COMMUNITY_WORKFLOWS as BUILTIN_COMMUNITY_WORKFLOWS, COMMUNITY_CATEGORIES, type CommunityCategory, type CommunityWorkflow } from '../landing/communityTypes';

const communityStore = localforage.createInstance({
  name: 'flovart',
  storeName: 'community_workflows_v1',
});

const USER_KEY = 'user-uploads';

export async function loadCommunityWorkflows(): Promise<CommunityWorkflow[]> {
  try {
    const userUploads = (await communityStore.getItem<CommunityWorkflow[]>(USER_KEY)) || [];
    const merged = [...userUploads, ...BUILTIN_COMMUNITY_WORKFLOWS];
    merged.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return merged;
  } catch (error) {
    console.warn('[communityStore] load failed, fallback to builtin', error);
    return BUILTIN_COMMUNITY_WORKFLOWS;
  }
}

export interface UploadWorkflowInput {
  title: string;
  description?: string;
  category: Exclude<CommunityCategory, '全部'>;
  tags: string[];
  gradient: string;
  workflowJson: WorkflowProject;
  author: { name: string; avatar?: string };
}

export async function publishCommunityWorkflow(input: UploadWorkflowInput): Promise<CommunityWorkflow> {
  const now = new Date().toISOString();
  const record: CommunityWorkflow = {
    id: `user-${nanoid()}`,
    title: input.title,
    description: input.description,
    thumbUrls: [],
    coverVideoUrl: undefined,
    gradient: input.gradient || 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    author: input.author,
    likes: 0,
    views: 0,
    forks: 0,
    category: input.category,
    tags: input.tags.slice(0, 8),
    workflowJson: input.workflowJson,
    createdAt: now,
  };
  const userUploads = (await communityStore.getItem<CommunityWorkflow[]>(USER_KEY)) || [];
  userUploads.unshift(record);
  await communityStore.setItem(USER_KEY, userUploads);
  return record;
}

export async function toggleCommunityLike(id: string): Promise<{ liked: boolean; likes: number }> {
  const userUploads = (await communityStore.getItem<CommunityWorkflow[]>(USER_KEY)) || [];
  const builtin = BUILTIN_COMMUNITY_WORKFLOWS.find(item => item.id === id);
  if (builtin) {
    const likedKey = `liked-${id}`;
    const liked = (await communityStore.getItem<boolean>(likedKey)) || false;
    const nextLiked = !liked;
    await communityStore.setItem(likedKey, nextLiked);
    return { liked: nextLiked, likes: builtin.likes + (nextLiked ? 1 : 0) };
  }
  const idx = userUploads.findIndex(item => item.id === id);
  if (idx === -1) return { liked: false, likes: 0 };
  const likedKey = `liked-${id}`;
  const liked = (await communityStore.getItem<boolean>(likedKey)) || false;
  const nextLiked = !liked;
  userUploads[idx] = { ...userUploads[idx], likes: Math.max(0, userUploads[idx].likes + (nextLiked ? 1 : -1)) };
  await communityStore.setItem(USER_KEY, userUploads);
  await communityStore.setItem(likedKey, nextLiked);
  return { liked: nextLiked, likes: userUploads[idx].likes };
}

export { COMMUNITY_CATEGORIES };