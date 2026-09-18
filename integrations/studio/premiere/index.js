(function () {
  // UXP fires the same index.js for `panel` and `command` entrypoints. Commands
  // are one-off actions: never mount the panel DOM for them.
  const host = window.FlovartStudioHosts.createPremiereAdapter({
    materializeClip: window.__FLOVART_PREMIERE_MATERIALIZE_CLIP__,
    importArtifact: window.__FLOVART_PREMIERE_IMPORT_ARTIFACT__,
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
      const prompt = (window.__FLOVART_COMMAND_PROMPT__ || '延续当前素材的风格与剪辑节奏，生成一个新素材箱片段。').trim();
      if (!controller) throw new Error('请连接 Flovart 后再使用当前选择生成。');
      return controller.generate(prompt, { kind: 'project' });
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
    hostLabel: 'Premiere · Clip',
    defaultImportTarget: { kind: 'project' },
    onOpenCanvas: openCanvas,
  });
  window.addEventListener('unload', () => panel.dispose());
})();
