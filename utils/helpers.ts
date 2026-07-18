export const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export type Rect = { x: number; y: number; width: number; height: number };