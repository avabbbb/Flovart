import { saveAgentConfig } from './config.js';

// agent.json 持久化失败（如 EPERM）只记录告警：内存中的授权与 URL 仍然生效，
// 不让一次写盘失败把已授权请求变成 500，也不在 listen 回调里抛出导致进程退出。
// 日志只含错误码与场景，不打印 config（其中含 token）或错误消息。
export function persistAgentConfig(config, context, save = saveAgentConfig) {
  try {
    save(config);
    return true;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
    console.warn('[flovart-agent] could not persist agent config (' + context + '): ' + code);
    return false;
  }
}
