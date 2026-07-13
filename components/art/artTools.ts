export type ArtToolId =
  | 'filter'
  | 'glitch'
  | 'depth'
  | 'remove-bg'
  | 'edges'
  | 'lineart'
  | 'normals'
  | 'pose';

export interface ArtToolDef {
  id: ArtToolId;
  label: string;
  description: string;
  icon: string;
  category: 'stylize' | 'extract' | 'cutout';
  mediaType: 'image' | 'video' | 'both';
}

export const ART_TOOLS: ArtToolDef[] = [
  { id: 'filter', label: '滤镜风格', description: '复古DV/VHS/胶片等预设滤镜,可微调', icon: 'Sparkles', category: 'stylize', mediaType: 'both' },
  { id: 'glitch', label: '故障风格', description: 'RGB分离/扫描线/噪点/撕裂', icon: 'Zap', category: 'stylize', mediaType: 'image' },
  { id: 'depth', label: '深度图提取', description: '从图片/视频提取深度灰度图(ControlNet)', icon: 'Mountain', category: 'extract', mediaType: 'both' },
  { id: 'edges', label: '边缘提取', description: 'Canny/Sobel 边缘检测图', icon: 'Spline', category: 'extract', mediaType: 'image' },
  { id: 'lineart', label: '线稿提取', description: '动漫/素描线稿', icon: 'PenLine', category: 'extract', mediaType: 'image' },
  { id: 'normals', label: '法线提取', description: '表面法线伪深度图', icon: 'Box', category: 'extract', mediaType: 'image' },
  { id: 'pose', label: '姿态提取', description: 'OpenPose 骨架图(MediaPipe Pose)', icon: 'PersonStanding', category: 'extract', mediaType: 'both' },
  { id: 'remove-bg', label: '智能抠图', description: 'AI 去除背景,生成透明PNG', icon: 'Scissors', category: 'cutout', mediaType: 'image' },
];

export const ART_TOOLS_MAP: Record<ArtToolId, ArtToolDef> = ART_TOOLS.reduce((acc, t) => {
  acc[t.id] = t;
  return acc;
}, {} as Record<ArtToolId, ArtToolDef>);
