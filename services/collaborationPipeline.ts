import type {
  CreativeProject,
  ExportPlan,
  ExportPreset,
  OutputCandidate,
  PublishingPackage,
  ReviewStatus,
} from '../types/collaboration';

export const DEFAULT_EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'ffmpeg-storyboard-16x9',
    label: 'FFmpeg Storyboard 16:9',
    target: 'ffmpeg',
    aspectRatio: '16:9',
    fps: 24,
    resolution: '1920x1080',
    includeAudio: false,
  },
  {
    id: 'social-short-9x16',
    label: 'Social Short 9:16',
    target: 'social',
    aspectRatio: '9:16',
    fps: 30,
    resolution: '1080x1920',
    includeAudio: true,
  },
  {
    id: 'project-json-bundle',
    label: 'Project JSON Bundle',
    target: 'json',
    includeAudio: false,
  },
];

function createPipelineId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return Date.now();
}

export function createCreativeProject(input: {
  name?: string;
  storyboardId?: string | null;
  assetIds?: string[];
  outputCandidateIds?: string[];
  status?: ReviewStatus;
} = {}): CreativeProject {
  const timestamp = now();
  return {
    id: createPipelineId('project'),
    name: input.name?.trim() || 'Creative Project',
    storyboardId: input.storyboardId ?? null,
    assetIds: input.assetIds ?? [],
    outputCandidateIds: input.outputCandidateIds ?? [],
    status: input.status ?? 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createOutputCandidate(input: {
  mediaType: OutputCandidate['mediaType'];
  shotId?: string | null;
  elementId?: string | null;
  prompt?: string;
  provider?: string;
  model?: string;
  status?: ReviewStatus;
  score?: number;
}): OutputCandidate {
  return {
    id: createPipelineId('candidate'),
    shotId: input.shotId ?? null,
    elementId: input.elementId ?? null,
    mediaType: input.mediaType,
    prompt: input.prompt,
    provider: input.provider,
    model: input.model,
    createdAt: now(),
    status: input.status ?? 'draft',
    score: input.score,
    selected: false,
  };
}

export function updateCandidateReview(
  candidate: OutputCandidate,
  patch: {
    status?: ReviewStatus;
    reviewNotes?: string;
    score?: number;
    selected?: boolean;
  },
): OutputCandidate {
  return {
    ...candidate,
    ...patch,
  };
}

export function selectOutputCandidate(
  candidates: OutputCandidate[],
  candidateId: string,
): OutputCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    selected: candidate.id === candidateId,
    status: candidate.id === candidateId ? 'approved' : candidate.status,
  }));
}

export function listExportPresets(target?: ExportPreset['target']): ExportPreset[] {
  return target
    ? DEFAULT_EXPORT_PRESETS.filter((preset) => preset.target === target)
    : DEFAULT_EXPORT_PRESETS;
}

export function createExportPlan(input: {
  projectId: string;
  presetId: string;
  candidateIds: string[];
  status?: ReviewStatus;
}): ExportPlan {
  const timestamp = now();
  return {
    id: createPipelineId('export'),
    projectId: input.projectId,
    presetId: input.presetId,
    candidateIds: [...input.candidateIds],
    status: input.status ?? 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function attachCandidateToProject(
  project: CreativeProject,
  candidateId: string,
): CreativeProject {
  const outputCandidateIds = project.outputCandidateIds ?? [];
  if (outputCandidateIds.includes(candidateId)) return project;

  return {
    ...project,
    outputCandidateIds: [...outputCandidateIds, candidateId],
    status: project.status === 'draft' ? 'in_review' : project.status,
    updatedAt: now(),
  };
}

export function updateProjectStatus(
  project: CreativeProject,
  status: ReviewStatus,
): CreativeProject {
  return {
    ...project,
    status,
    updatedAt: now(),
  };
}

export function createPublishingPackage(input: {
  project: CreativeProject;
  exportPlan: ExportPlan;
  preset: ExportPreset;
  candidates: OutputCandidate[];
  storyboardShotCount?: number;
  status?: ReviewStatus;
}): PublishingPackage {
  const timestamp = now();
  return {
    id: createPipelineId('package'),
    projectId: input.project.id,
    exportPlanId: input.exportPlan.id,
    presetId: input.preset.id,
    candidateIds: [...input.exportPlan.candidateIds],
    status: input.status ?? 'published',
    manifest: {
      projectName: input.project.name,
      presetLabel: input.preset.label,
      target: input.preset.target,
      candidateCount: input.candidates.length,
      mediaTypes: Array.from(new Set(input.candidates.map((candidate) => candidate.mediaType))),
      storyboardShotCount: input.storyboardShotCount,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
