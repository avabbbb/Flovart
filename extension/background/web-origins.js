// 网页画布允许连接插件的来源。
// 必须与 manifest.json 的 externally_connectable.matches 一一对应，tests/extensionWebBridge.test.js 会校验。
const WEB_HOSTS = [
  ['https', 'flovart.avabbbb.com'],
  // 本地开发：vite.config.ts 默认端口 37522（strictPort）。动态端口模式不在白名单内。
  ['http', '127.0.0.1:37522'],
  ['http', 'localhost:37522'],
];

export const WEB_ORIGINS = new Set(WEB_HOSTS.map(([scheme, host]) => scheme + '://' + host));
export const WEB_MATCH_PATTERNS = WEB_HOSTS.map(([scheme, host]) => scheme + '://' + host + '/' + String.fromCharCode(42));

export function isAllowedWebOrigin(origin) {
  return typeof origin === 'string' && WEB_ORIGINS.has(origin);
}
