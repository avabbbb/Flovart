export type ReviewStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'exported'
  | 'published';

export interface OutputCandidate {
  id: string;
  shotId?: string | null;
  elementId?: string | null;
  mediaType: 'image' | 'video';
  prompt?: string;
  provider?: string;
  model?: string;
  createdAt: number;
  status: ReviewStatus;
  reviewNotes?: string;
  score?: number;
  selected?: boolean;
}

export interface CreativeProject {
  id: string;
  name: string;
  storyboardId?: string | null;
  assetIds?: string[];
  outputCandidateIds?: string[];
  status: ReviewStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ExportPreset {
  id: string;
  label: string;
  target: 'ffmpeg' | 'remotion' | 'capcut' | 'json' | 'social';
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
  fps?: number;
  resolution?: string;
  includeAudio?: boolean;
}

export interface ExportPlan {
  id: string;
  projectId: string;
  presetId: string;
  candidateIds: string[];
  status: ReviewStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PublishingPackage {
  id: string;
  projectId: string;
  exportPlanId: string;
  presetId: string;
  candidateIds: string[];
  status: ReviewStatus;
  manifest: {
    projectName: string;
    presetLabel: string;
    target: ExportPreset['target'];
    candidateCount: number;
    mediaTypes: OutputCandidate['mediaType'][];
    storyboardShotCount?: number;
  };
  createdAt: number;
  updatedAt: number;
}
