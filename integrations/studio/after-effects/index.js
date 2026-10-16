(function () {
  const host = window.FlovartStudioHosts.createAfterEffectsAdapter({
    // CEP/ExtendScript integration is Link-owned; the panel never receives Provider credentials.
    bridge: window.__FLOVART_AFTER_EFFECTS_BRIDGE__,
  });
  const panel = window.FlovartStudioUI.mountInspector({
    root: document.getElementById('app'),
    adapter: host,
    getController: () => window.__FLOVART_STUDIO_CONTROLLER__ || null,
    hostLabel: 'After Effects · Layer',
    defaultImportTarget: { kind: 'new-layer' },
    onOpenCanvas: () => {
      if (!window.__FLOVART_OPEN_CANVAS__) throw new Error('请连接 Flovart 后打开画布。');
      return window.__FLOVART_OPEN_CANVAS__();
    },
  });
  window.addEventListener('unload', () => panel.dispose());
})();
