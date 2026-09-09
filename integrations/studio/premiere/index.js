(function () {
  const host = window.FlovartStudioHosts.createPremiereAdapter({
    materializeClip: window.__FLOVART_PREMIERE_MATERIALIZE_CLIP__,
    importArtifact: window.__FLOVART_PREMIERE_IMPORT_ARTIFACT__,
  });
  const panel = window.FlovartStudioUI.mountInspector({
    root: document.getElementById('app'),
    adapter: host,
    getController: () => window.__FLOVART_STUDIO_CONTROLLER__ || null,
    hostLabel: 'Premiere · Clip',
    defaultImportTarget: { kind: 'project' },
    onOpenCanvas: () => {
      if (!window.__FLOVART_OPEN_CANVAS__) throw new Error('请连接 Flovart 后打开画布。');
      return window.__FLOVART_OPEN_CANVAS__();
    },
  });
  window.addEventListener('unload', () => panel.dispose());
})();
