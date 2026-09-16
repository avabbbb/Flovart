export function toLinkPublicStatus(input) {
  if (input.service !== 'ready' || input.browserConnected === false || input.writerActive === false) {
    return { state: 'offline', label: '离线', message: 'Flovart 本地服务暂时离线。', action: 'repair' };
  }
  if (input.authState === 'needs-login' || input.host?.authStatus === 'needs-login') {
    return { state: 'needs_login', label: '需登录', message: '请先登录这个助手，再回来继续。', action: 'login' };
  }
  if (input.host?.status === 'manual-import' || input.host?.status === 'external-plugin' || input.host?.status === 'unavailable' || input.host?.available === false) {
    return { state: 'needs_setup', label: '需安装', message: '先安装或导入这个助手的 Flovart 入口。', action: 'setup' };
  }
  return { state: 'ready', label: '已准备', message: '可以操作当前项目。', action: 'use' };
}

export function publicStateLabel(state) {
  return ({ ready: '已准备', needs_setup: '需安装', needs_login: '需登录', offline: '离线' })[state];
}

export function toLocalLinkPublicStatus(status) {
  const authError = String(status.agent?.error || '').toLowerCase();
  if (status.agent?.status === 'auth_failed' && /token|认证|401|invalid/.test(authError)) {
    return { state: 'needs_login', label: '需登录', message: '请先登录本机 Agent，再回来继续。', action: 'login' };
  }
  if (status.agent?.status === 'auth_failed' && /配置|config|未找到|缺少/.test(authError)) {
    return { state: 'needs_setup', label: '需安装', message: 'Flovart 本地服务尚未完成准备。', action: 'setup' };
  }
  if (status.ready && status.agent?.status === 'ready' && status.browserConnected !== false) {
    return { state: 'ready', label: '已准备', message: '可以操作当前项目。', action: 'use' };
  }
  if (status.agent?.status === 'auth_failed') {
    return { state: 'needs_setup', label: '需安装', message: 'Flovart 本地服务尚未完成准备。', action: 'setup' };
  }
  return { state: 'offline', label: '离线', message: 'Flovart 本地服务暂时离线。', action: 'repair' };
}
