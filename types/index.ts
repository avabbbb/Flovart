

export type Tool = 'select' | 'pan' | 'draw' | 'erase' | 'rectangle' | 'circle' | 'triangle' | 'text' | 'arrow' | 'highlighter' | 'lasso' | 'line';

export type WheelAction = 'zoom' | 'pan';

export type GenerationMode = 'text' | 'image' | 'video' | 'keyframe';

export interface Point {
  x: number;
  y: number;
}

export interface CanvasElementBase {
  id: string;
  x: number;
  y: number;
  name?: string;
  isVisible?: boolean;
  isLocked?: boolean;
  parentId?: string;
  generationState?: ElementGenerationState;
}

export type GenerationStatus = 'idle' | 'queued' | 'running' | 'success' | 'error';

export type AssetSlotRole =
  | 'first_frame'
  | 'last_frame'
  | 'reference_image'
  | 'reference_video'
  | 'reference_audio'
  | 'style_ref'
  | 'control_net'
  | 'unassigned';

export type InlineGenerationProvider =
  | 'openrouter'
  | 'siliconflow'
  | 'google'
  | 'keling'
  | 'midjourney'
  | 'openai_compatible';

export interface ResolvedReference {
  token: string;
  targetElementId: string;
  targetType: 'image' | 'video' | 'text';
  slotRole?: AssetSlotRole;
}

export interface AdaptivePromptPayload {
  rawText: string;
  resolvedReferences: ResolvedReference[];
  richTextDocument?: Record<string, unknown>;
}

export interface ElementGenerationState {
  promptPayload: AdaptivePromptPayload;
  provider: InlineGenerationProvider;
  modelId: string;
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '3:2' | '2:3' | '21:9' | 'adaptive';
  durationSec?: number;
  resolution?: '480p' | '720p' | '1080p' | string;
  generateAudio?: boolean;
  watermark?: boolean;
  status: GenerationStatus;
  error?: string;
  progress?: number;
}

/** 图片滤镜/调色参数 */
export interface ImageFilters {
  brightness: number;   // 0�?00, default 100
  contrast: number;     // 0�?00, default 100
  saturate: number;     // 0�?00, default 100
  hueRotate: number;    // 0�?60, default 0
  blur: number;         // 0�?0,  default 0
  opacity: number;      // 0�?00, default 100
  grayscale: number;    // 0�?00, default 0
  sepia: number;        // 0�?00, default 0
  temperature: number;  // -100�?00, default 0 (暖色/冷色)
  sharpen: number;      // 0�?00, default 0
}

export const DEFAULT_IMAGE_FILTERS: ImageFilters = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hueRotate: 0,
  blur: 0,
  opacity: 100,
  grayscale: 0,
  sepia: 0,
  temperature: 0,
  sharpen: 0,
};

export interface ImageElement extends CanvasElementBase {
  type: 'image';
  href: string; 
  width: number;
  height: number;
  mimeType: string;
  borderRadius?: number;
  filters?: Partial<ImageFilters>;
  /** Non-destructive layer mask: data URL of grayscale image. White = visible, Black = hidden */
  mask?: string;
}

export interface VideoElement extends CanvasElementBase {
  type: 'video';
  href: string; // Blob URL
  width: number;
  height: number;
  mimeType: string;
  poster?: string;
  durationSec?: number;
  sourceKind?: 'upload' | 'generation';
  generationMeta?: {
    prompt?: string;
    provider?: string;
    model?: string;
  };
}

export interface PathElement extends CanvasElementBase {
  type: 'path';
  points: Point[];
  strokeColor: string;
  strokeWidth: number;
  strokeOpacity?: number;
}

export interface ShapeElement extends CanvasElementBase {
    type: 'shape';
    shapeType: 'rectangle' | 'circle' | 'triangle';
    width: number;
    height: number;
    strokeColor: string;
    strokeWidth: number;
    fillColor: string;
    borderRadius?: number;
    strokeDashArray?: [number, number];
}

export interface TextElement extends CanvasElementBase {
    type: 'text';
    text: string;
    fontSize: number;
    fontColor: string;
    width: number;
    height: number;
}

export interface ArrowElement extends CanvasElementBase {
    type: 'arrow';
    points: [Point, Point];
    strokeColor: string;
    strokeWidth: number;
}

export interface LineElement extends CanvasElementBase {
    type: 'line';
    points: [Point, Point];
    strokeColor: string;
    strokeWidth: number;
}

export interface GroupElement extends CanvasElementBase {
    type: 'group';
    width: number;
    height: number;
}


export type CanvasElement = ImageElement | VideoElement | TextElement | ShapeElement;
export type Element = CanvasElement | PathElement | ArrowElement | LineElement | GroupElement;

export interface UserEffect {
  id: string;
  name: string;
  value: string;
}

export interface Board {
  id: string;
  name: string;
  elements: Element[];
  history: Element[][];
  historyIndex: number;
  panOffset: Point;
  zoom: number;
  canvasBackgroundColor: string;
}

// Asset Library
//
// 资产模型：文件夹 + 标签双轴
// - 文件夹（AssetFolder）支持无限嵌套树（parentId 串联），parentId 为 null 表示根级
// - 一个 AssetItem 可同时归属多个文件夹（folderIds: string[]），类似 Eagle 的 Add To Folders
// - 标签（tags: string[]）是跨文件夹横切组织维度，支持任意字符串
// - 迁移自旧版 character/scene/prop 三桶结构时，旧 category 名作为标签兜底语义

export interface AssetFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

export interface AssetItem {
  id: string;
  name?: string;
  folderIds: string[];      // 所属文件夹 id 列表，空数组表示"未分类"
  tags: string[];           // 跨文件夹横切标签
  dataUrl: string;          // base64 或 blob URL
  mimeType: string;        // image/png, image/jpeg, video/mp4...
  width: number;
  height: number;
  createdAt: number;
  source?: 'local' | 'extension' | 'generation' | 'recipe' | 'market';
  sourceUrl?: string;
  prompt?: string;
  provider?: string;
  model?: string;
  generationParams?: Record<string, unknown>;
}

export interface AssetLibrary {
  folders: AssetFolder[];   // 扁平文件夹数组，靠 parentId 串成树
  items: AssetItem[];        // 扁平素材列表
}

export interface GenerationHistoryItem {
  id: string;
  name?: string;
  dataUrl: string;        // 图片 base64 或视频缩略图 base64
  mimeType: string;
  width: number;
  height: number;
  prompt: string;
  createdAt: number;
  /** 生成类型：image | video，默�?image */
  mediaType?: 'image' | 'video';
  provider?: string;
  model?: string;
  generationParams?: Record<string, unknown>;
}

export interface GenerationRecipe {
  prompt: string;
  provider?: string;
  model?: string;
  generationParams?: Record<string, unknown>;
}

export interface RecipePackage {
  version: 1;
  asset: {
    name?: string;
    folderIds: string[];   // 安装时归入哪些文件夹，空数组表示"未分类"
    tags: string[];        // 附带标签
    dataUrl: string;
    mimeType: string;
    width: number;
    height: number;
  };
  recipe: GenerationRecipe;
  createdAt: number;
}

// API Key & Model Preferences
export type ThemeMode = 'light' | 'dark' | 'system';
export type WorkspaceView = 'workflow' | 'table';
export type AIProvider = 'openai' | 'anthropic' | 'google' | 'qwen' | 'deepseek' | 'xai' | 'siliconflow' | 'keling' | 'flux' | 'midjourney' | 'runningHub' | 'minimax' | 'volcengine' | 'openrouter' | 'openai_compatible' | 'custom';
export type AICapability = 'text' | 'image' | 'video' | 'agent';

/** 模型条目（用于结构化展示�?*/
export interface ModelItem {
  id: string;
  name: string;
}

export type ProductModelMode =
  | 'text-to-image'
  | 'image-to-image'
  | 'text-to-video'
  | 'image-to-video'
  | 'reference-to-video'
  | 'first-last-frame'
  | 'video-extension';

export interface ProductModelMapping {
  productModelId: string;
  upstreamModelId: string;
  priority: number;
  enabled: boolean;
  confirmed: boolean;
}

export type ApiPricingUnit = 'request' | 'image' | 'video_second' | 'input_token' | 'output_token';

export interface ApiPricingRule {
  id: string;
  productModelId?: string;
  upstreamModelId?: string;
  unit: ApiPricingUnit;
  rate: number;
  currency: 'USD' | 'CNY';
  resolution?: string;
  quality?: string;
  source: 'official' | 'manual';
}

export interface ApiBudgetPolicy {
  enabled: boolean;
  monthlyLimit: number;
  warningPercent: number;
  hardStop: boolean;
  currency: 'USD' | 'CNY';
}

export interface UserApiKey {
  id: string;
  provider: AIProvider;
  capabilities: AICapability[];
  key: string;
  baseUrl?: string;
  name?: string;
  isDefault?: boolean;
  status?: 'unknown' | 'ok' | 'error';
  /** 用户为这�?Key 自定义的可调用模型列�?*/
  customModels?: string[];
  /** 这些自定义模型中用户设定的默认模�?*/
  defaultModel?: string;
  /** 结构化模型列表（可选，优先�?customModels 展示�?*/
  models?: ModelItem[];
  /** Provider 特有的额外配置（�?Google Veo �?projectId�?*/
  extraConfig?: Record<string, string>;
  /** Flovart 固定产品模型到上游模型 ID 的显式映射。 */
  modelMappings?: ProductModelMapping[];
  /** 该 Key / 模型线路的计价规则。 */
  pricingRules?: ApiPricingRule[];
  /** 该 Key 的月度预算策略。 */
  budgetPolicy?: ApiBudgetPolicy;
  createdAt: number;
  updatedAt: number;
}

export interface ModelPreference {
  textModel: string;
  imageModel: string;
  videoModel: string;
}

// Agent / Workflow
export type WorkspaceMode = 'whiteboard' | 'node';

// Multi-Agent Chat System
export type AgentRoleId = 'creative_director' | 'prompt_engineer' | 'style_master' | 'compositor' | 'quality_reviewer' | string;

export interface AgentRole {
    id: AgentRoleId;
    name: string;
    emoji: string;
    color: string;
    systemPrompt: string;
    description: string;
}

export interface AgentConfig {
    id: string;
    roleId: AgentRoleId;
    enabled: boolean;
    provider?: AIProvider;
    model?: string;
}

export interface AgentMessage {
    id: string;
    agentId: string;
    agentName: string;
    agentEmoji: string;
    agentColor: string;
    role: 'user' | 'agent' | 'system';
    content: string;
    timestamp: number;
    isGenerating?: boolean;
    imageUrl?: string;
}

export interface AgentBudget {
    maxCost: number;
    currentCost: number;
    maxRounds: number;
}

export interface AgentSession {
    id: string;
    task: string;
    agents: AgentConfig[];
    messages: AgentMessage[];
    status: 'idle' | 'discussing' | 'generating' | 'completed' | 'error' | 'stopped';
    currentRound: number;
    budget: AgentBudget;
    finalPrompt?: string;
}
export type PromptEnhanceMode = 'smart' | 'style' | 'precise' | 'translate';

export interface PromptEnhanceRequest {
  prompt: string;
  mode: PromptEnhanceMode;
  stylePreset?: string;
}

export interface PromptEnhanceResult {
  enhancedPrompt: string;
  negativePrompt: string;
  suggestions: string[];
  notes?: string;
}

export interface CharacterLockProfile {
  id: string;
  name: string;
  anchorElementId: string;
  referenceImage: string; // dataURL
  descriptor: string;
  createdAt: number;
  isActive: boolean;
}

export interface ChatAttachment {
  id: string;
  name: string;
  href: string;
  mimeType: string;
  source: 'canvas' | 'upload';
}
