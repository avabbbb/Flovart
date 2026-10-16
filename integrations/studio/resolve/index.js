(function () {
  const host = window.FlovartStudioHosts.createResolveAdapter({
    // Resolve Workflow Integration injects this bridge; no Provider or key is read here.
    bridge: window.__FLOVART_RESOLVE_BRIDGE__,
  });
  const panel = window.FlovartStudioUI.mountInspector({
    root: document.getElementById('app'),
    adapter: host,
    getController: () => window.__FLOVART_STUDIO_CONTROLLER__ || null,
    hostLabel: 'DaVinci Resolve · Clip',
    defaultImportTarget: { kind: 'media-pool' },
    onOpenCanvas: () => {
      if (!window.__FLOVART_OPEN_CANVAS__) throw new Error('请连接 Flovart 后打开画布。');
      return window.__FLOVART_OPEN_CANVAS__();
    },
  });
  window.addEventListener('unload', () => panel.dispose());
})();
