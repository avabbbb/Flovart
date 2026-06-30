// 打光预设：26 主光 + 9 轮廓光
// 每项含 prompt 关键词，用于注入图生图 prompt

export interface LightingPreset {
  id: string;
  name: string;
  type: 'main' | 'rim';
  promptKeyword: string;
  description: string;
}

export const LIGHTING_PRESETS: LightingPreset[] = [
  // 主光 26 预设
  { id: 'soft-box', name: '柔光箱', type: 'main', promptKeyword: 'soft box lighting', description: '均匀柔和的主光' },
  { id: 'key-light', name: '主光灯', type: 'main', promptKeyword: 'key light from front', description: '经典正面主光' },
  { id: 'rembrandt', name: '伦勃朗光', type: 'main', promptKeyword: 'rembrandt lighting', description: '45度主光，三角光斑' },
  { id: 'butterfly', name: '蝴蝶光', type: 'main', promptKeyword: 'butterfly lighting', description: '正上方主光，鼻下蝴蝶阴影' },
  { id: 'split-light', name: '分割光', type: 'main', promptKeyword: 'split lighting', description: '侧面90度，半脸受光' },
  { id: 'loop', name: '环形光', type: 'main', promptKeyword: 'loop lighting', description: '鼻影小环形' },
  { id: 'broad', name: '宽光', type: 'main', promptKeyword: 'broad lighting', description: '亮面朝向相机' },
  { id: 'short', name: '窄光', type: 'main', promptKeyword: 'short lighting', description: '暗面朝向相机' },
  { id: 'window', name: '窗户光', type: 'main', promptKeyword: 'soft window light from left', description: '自然窗光' },
  { id: 'golden-hour', name: '黄金时刻', type: 'main', promptKeyword: 'golden hour sunlight', description: '日落暖光' },
  { id: 'blue-hour', name: '蓝色时刻', type: 'main', promptKeyword: 'blue hour ambient', description: '黎明/黄昏冷蓝光' },
  { id: 'overcast', name: '阴天光', type: 'main', promptKeyword: 'overcast soft diffused light', description: '阴天漫射光' },
  { id: 'studio-umbrella', name: '伞灯', type: 'main', promptKeyword: 'studio umbrella lighting', description: '反光伞柔光' },
  { id: 'beauty-dish', name: '雷达罩', type: 'main', promptKeyword: 'beauty dish lighting', description: '蜂巢雷达罩' },
  { id: 'ring-light', name: '环形灯', type: 'main', promptKeyword: 'ring light, flat frontal illumination', description: '美妆环形灯' },
  { id: 'spotlight', name: '聚光灯', type: 'main', promptKeyword: 'dramatic spotlight', description: '硬质聚光' },
  { id: 'firelight', name: '火光', type: 'main', promptKeyword: 'warm firelight glow', description: '篝火暖光' },
  { id: 'moonlight', name: '月光', type: 'main', promptKeyword: 'cool moonlight', description: '冷蓝月光' },
  { id: 'neon', name: '霓虹光', type: 'main', promptKeyword: 'neon light, cyan and magenta', description: '赛博朋克霓虹' },
  { id: 'tv-glow', name: '电视光', type: 'main', promptKeyword: 'flickering TV glow', description: '电视闪烁光' },
  { id: 'candle', name: '烛光', type: 'main', promptKeyword: 'candlelight, warm intimate', description: '烛光暖调' },
  { id: 'fluorescent', name: '荧光灯', type: 'main', promptKeyword: 'fluorescent tube light', description: '冷白荧光' },
  { id: 'sunset', name: '夕阳', type: 'main', promptKeyword: 'sunset backlight, orange glow', description: '夕阳逆光' },
  { id: 'forest', name: '林间光', type: 'main', promptKeyword: 'dappled forest light through leaves', description: '林间斑驳光' },
  { id: 'underwater', name: '水下光', type: 'main', promptKeyword: 'underwater caustic light', description: '水下焦散光' },
  { id: 'volumetric', name: '体积光', type: 'main', promptKeyword: 'volumetric god rays', description: '体积光束' },

  // 轮廓光 9 预设
  { id: 'rim-soft', name: '柔边轮廓光', type: 'rim', promptKeyword: 'soft rim light from behind', description: '柔和边缘光' },
  { id: 'rim-hard', name: '硬边轮廓光', type: 'rim', promptKeyword: 'hard rim light, sharp edge', description: '锐利边缘光' },
  { id: 'hair-light', name: '发丝光', type: 'rim', promptKeyword: 'hair light from top back', description: '头顶发丝光' },
  { id: 'kicker', name: '侧逆光', type: 'rim', promptKeyword: 'kicker light from back side', description: '侧后方轮廓光' },
  { id: 'backlight', name: '逆光', type: 'rim', promptKeyword: 'strong backlight, silhouette edge', description: '强逆光勾边' },
  { id: 'edge-glow', name: '边缘辉光', type: 'rim', promptKeyword: 'glowing edge light', description: '辉光边缘' },
  { id: 'halo', name: '光环', type: 'rim', promptKeyword: 'halo light around head', description: '头部光环' },
  { id: 'rim-colored', name: '彩色轮廓光', type: 'rim', promptKeyword: 'colored rim light, teal and orange', description: '双色轮廓光' },
  { id: 'rim-narrow', name: '窄轮廓光', type: 'rim', promptKeyword: 'thin rim light strip', description: '细窄边缘光' },
];

export function buildRelightPrompt(preset: LightingPreset, intensity: number, color: string, smart: boolean): string {
  const parts: string[] = [];
  if (smart) parts.push('intelligently analyze the scene and');
  parts.push(`relight with ${preset.promptKeyword}`);
  parts.push(`intensity ${intensity.toFixed(1)}`);
  if (color && color !== '#ffffff') parts.push(`tint ${color}`);
  return parts.join(', ');
}
