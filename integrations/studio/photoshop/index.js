(function () {
  // UXP fires the same index.js for `panel` and `command` entrypoints. Commands
  // are one-off actions: never mount the panel DOM for them.
  const host = window.FlovartStudioHosts.createPhotoshopAdapter({
    // Layer export/import remain Link-owned capabilities. The panel never receives Provider credentials.
    exportLayer: window.__FLOVART_PHOTOSHOP_EXPORT_LAYER__,
    importArtifact: window.__FLOVART_PHOTOSHOP_IMPORT_ARTIFACT__,
  });
  const openCanvas = () => {
    if (!window.__FLOVART_OPEN_CANVAS__) throw new Error('请连接 Flovart 后打开画布。');
    return window.__FLOVART_OPEN_CANVAS__();
  };
  const getController = () => window.__FLOVART_STUDIO_CONTROLLER__ || null;
  async function runCommand(id) {
    if (id === 'flovartOpenCanvas') return openCanvas();
    if (id === 'flovartGenerateFromSelection') {
      const controller = getController();
      const prompt = (window.__FLOVART_COMMAND_PROMPT__ || '延续当前选择的风格与构图，生成一个新图层。').trim();
      if (!controller) throw new Error('请连接 Flovart 后再使用当前选择生成。');
      return controller.generate(prompt, { kind: 'new-layer' });
    }
    return undefined;
  }
  // A command entrypoint signals itself through `uxp.entrypoints` when it is
  // invoked; only the persistent `panel` entrypoint mounts the inspector.
  const entrypoint = window.uxp?.entrypoints?.lastInvoked;
  if (entrypoint?.type === 'command') { runCommand(entrypoint.id); return; }
  const panel = window.FlovartStudioUI.mountInspector({
    root: document.getElementById('app'),
    adapter: host,
    getController,
    hostLabel: 'Photoshop',
    onOpenCanvas: openCanvas,
  });
  window.addEventListener('unload', () => panel.dispose());
})();
