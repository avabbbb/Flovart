(function () {
  const host = window.FlovartStudioHosts.createPhotoshopAdapter({
    // Layer export/import remain Link-owned capabilities. The panel never receives Provider credentials.
    exportLayer: window.__FLOVART_PHOTOSHOP_EXPORT_LAYER__,
    importArtifact: window.__FLOVART_PHOTOSHOP_IMPORT_ARTIFACT__,
  });
  const panel = window.FlovartStudioUI.mountInspector({
    root: document.getElementById('app'),
    adapter: host,
    getController: () => window.__FLOVART_STUDIO_CONTROLLER__ || null,
    hostLabel: 'Photoshop',
    onOpenCanvas: () => {
      if (!window.__FLOVART_OPEN_CANVAS__) throw new Error('请连接 Flovart 后打开画布。');
      return window.__FLOVART_OPEN_CANVAS__();
    },
  });
  window.addEventListener('unload', () => panel.dispose());
})();
