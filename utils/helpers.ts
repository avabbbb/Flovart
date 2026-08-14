export const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// friendlyError 把网络层错误转成用户可读中文提示，避免 "Failed to fetch" 等裸英文进 UI
export const friendlyError = (e: unknown, fallback = '操作失败'): string => {
  let msg = '';
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string') {
    msg = e.message;
  }
  if (!msg || /Failed to fetch|NetworkError|Network Error|Load failed|fetch failed|ERR_CONNECTION|ECONNREFUSED/i.test(msg)) {
    return '网络连接失败，请检查后端服务是否已启动';
  }
  return msg || fallback;
};

export type Rect = { x: number; y: number; width: number; height: number };