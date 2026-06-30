export type VoiceProvider = 'minimax' | 'openai' | 'custom';

export interface VoicePreset {
  id: string;
  provider: VoiceProvider;
  voiceId: string;
  name: string;
  description?: string;
  language?: string;
  gender?: 'male' | 'female' | 'neutral';
  emotionCapable?: boolean;
}

const MINIMAX_SPEECH_28_VOICES: VoicePreset[] = [
  { id: 'minimax-wise-woman', provider: 'minimax', voiceId: 'Wise_Woman', name: 'Wise Woman', description: '智慧女性', language: '多语种', gender: 'female', emotionCapable: true },
  { id: 'minimax-friendly-person', provider: 'minimax', voiceId: 'Friendly_Person', name: 'Friendly Person', description: '友善人士', language: '多语种', gender: 'neutral', emotionCapable: true },
  { id: 'minimax-inspirational-girl', provider: 'minimax', voiceId: 'Inspirational_girl', name: 'Inspirational Girl', description: '鼓舞少女', language: '多语种', gender: 'female', emotionCapable: true },
  { id: 'minimax-deep-voice-man', provider: 'minimax', voiceId: 'Deep_Voice_Man', name: 'Deep Voice Man', description: '深沉男声', language: '多语种', gender: 'male', emotionCapable: true },
  { id: 'minimax-calm-woman', provider: 'minimax', voiceId: 'Calm_Woman', name: 'Calm Woman', description: '冷静女声', language: '多语种', gender: 'female', emotionCapable: true },
  { id: 'minimax-casual-guy', provider: 'minimax', voiceId: 'Casual_Guy', name: 'Casual Guy', description: '随性男声', language: '多语种', gender: 'male', emotionCapable: true },
  { id: 'minimax-lively-girl', provider: 'minimax', voiceId: 'Lively_Girl', name: 'Lively Girl', description: '活泼少女', language: '多语种', gender: 'female', emotionCapable: true },
  { id: 'minimax-patient-man', provider: 'minimax', voiceId: 'Patient_Man', name: 'Patient Man', description: '耐心男声', language: '多语种', gender: 'male', emotionCapable: true },
  { id: 'minimax-young-knight', provider: 'minimax', voiceId: 'Young_Knight', name: 'Young Knight', description: '年轻骑士', language: '多语种', gender: 'male', emotionCapable: true },
  { id: 'minimax-determined-man', provider: 'minimax', voiceId: 'Determined_Man', name: 'Determined Man', description: '坚毅男声', language: '多语种', gender: 'male', emotionCapable: true },
  { id: 'minimax-lovely-girl', provider: 'minimax', voiceId: 'Lovely_Girl', name: 'Lovely Girl', description: '可爱少女', language: '多语种', gender: 'female', emotionCapable: true },
  { id: 'minimax-decent-boy', provider: 'minimax', voiceId: 'Decent_Boy', name: 'Decent Boy', description: '正派少年', language: '多语种', gender: 'male', emotionCapable: true },
  { id: 'minimax-imposing-manner', provider: 'minimax', voiceId: 'Imposing_Manner', name: 'Imposing Manner', description: '威严气场', language: '多语种', gender: 'male', emotionCapable: true },
  { id: 'minimax-elegant-man', provider: 'minimax', voiceId: 'Elegant_Man', name: 'Elegant Man', description: '儒雅男声', language: '多语种', gender: 'male', emotionCapable: true },
  { id: 'minimax-abbess', provider: 'minimax', voiceId: 'Abbess', name: 'Abbess', description: '女院长', language: '多语种', gender: 'female', emotionCapable: true },
  { id: 'minimax-sweet-girl-2', provider: 'minimax', voiceId: 'Sweet_Girl_2', name: 'Sweet Girl 2', description: '甜美少女 2', language: '多语种', gender: 'female', emotionCapable: true },
  { id: 'minimax-exuberant-girl', provider: 'minimax', voiceId: 'Exuberant_Girl', name: 'Exuberant Girl', description: '热情少女', language: '多语种', gender: 'female', emotionCapable: true },
];

const OPENAI_TTS_VOICES: VoicePreset[] = [
  { id: 'openai-alloy', provider: 'openai', voiceId: 'alloy', name: 'Alloy', description: '中性平稳', language: '英语', gender: 'neutral' },
  { id: 'openai-echo', provider: 'openai', voiceId: 'echo', name: 'Echo', description: '温和男声', language: '英语', gender: 'male' },
  { id: 'openai-fable', provider: 'openai', voiceId: 'fable', name: 'Fable', description: '叙事中性', language: '英语', gender: 'neutral' },
  { id: 'openai-onyx', provider: 'openai', voiceId: 'onyx', name: 'Onyx', description: '深沉男声', language: '英语', gender: 'male' },
  { id: 'openai-nova', provider: 'openai', voiceId: 'nova', name: 'Nova', description: '明亮女声', language: '英语', gender: 'female' },
  { id: 'openai-shimmer', provider: 'openai', voiceId: 'shimmer', name: 'Shimmer', description: '柔和女声', language: '英语', gender: 'female' },
  { id: 'openai-corral', provider: 'openai', voiceId: 'corral', name: 'Corral', description: '沉稳叙事', language: '英语', gender: 'neutral' },
  { id: 'openai-ash', provider: 'openai', voiceId: 'ash', name: 'Ash', description: '年轻男声', language: '英语', gender: 'male' },
  { id: 'openai-sage', provider: 'openai', voiceId: 'sage', name: 'Sage', description: '知性女声', language: '英语', gender: 'female' },
];

export const VOICE_CATALOG: VoicePreset[] = [...MINIMAX_SPEECH_28_VOICES, ...OPENAI_TTS_VOICES];

export function getVoicesByProvider(provider: VoiceProvider): VoicePreset[] {
  return VOICE_CATALOG.filter(voice => voice.provider === provider);
}

export function findVoice(voiceId: string): VoicePreset | null {
  return VOICE_CATALOG.find(voice => voice.voiceId === voiceId) || null;
}

export function isCustomVoiceId(value: string): boolean {
  return Boolean(value) && !findVoice(value);
}
