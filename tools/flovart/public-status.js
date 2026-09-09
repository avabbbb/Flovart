export function toLinkPublicStatus(input) {
  if (input.service !== 'ready' || input.browserConnected === false || input.writerActive === false) {
    return { state: 'offline', label: '本地服务不可用', message: 'Flovart 本地服务暂时不可用，可以自动修复。', action: 'repair' };
  }
  if (input.authState === 'needs-login' || input.host?.authStatus === 'needs-login') {
    return { state: 'needs_login', label: '需要登录', message: '请先登录这个助手，再回来继续。', action: 'login' };
  }
  if (input.host?.status === 'manual-import' || input.host?.status === 'external-plugin' || input.host?.status === 'unavailable' || input.host?.available === false) {
    return { state: 'needs_setup', label: '需要准备', message: '先安装或导入这个助手的 Flovart 入口。', action: 'setup' };
  }
  return { state: 'ready', label: '已就绪', message: '可以开始协作当前项目。', action: 'use' };
}

export function publicStateLabel(state) {
  return ({ ready: '已就绪', needs_setup: '需要准备', needs_login: '需要登录', offline: '本地服务不可用' })[state];
}

export function toLocalLinkPublicStatus(status) {
  const authError = String(status.agent?.error || '').toLowerCase();
  if (status.agent?.status === 'auth_failed' && /token|认证|401|invalid/.test(authError)) {
    return { state: 'needs_login', label: '需要登录', message: '请先登录本机 Agent，再回来继续。', action: 'login' };
  }
  if (status.agent?.status === 'auth_failed' && /配置|config|未找到|缺少/.test(authError)) {
    return { state: 'needs_setup', label: '需要准备', message: 'Flovart 本地服务尚未完成准备。', action: 'setup' };
  }
  if (status.ready && status.agent?.status === 'ready' && status.browserConnected !== false) {
    return { state: 'ready', label: '已就绪', message: '可以开始协作当前项目。', action: 'use' };
  }
  if (status.agent?.status === 'auth_failed') {
    return { state: 'needs_setup', label: '需要准备', message: 'Flovart 本地服务尚未完成准备。', action: 'setup' };
  }
  return { state: 'offline', label: '本地服务不可用', message: 'Flovart 本地服务暂时不可用，可以自动修复。', action: 'repair' };
}
