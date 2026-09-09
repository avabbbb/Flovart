const { contextBridge, ipcRenderer } = require('electron');

function bytesToBlob(value) {
  if (!value?.base64) return value;
  const binary = atob(value.base64);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return { blob: new Blob([bytes], { type: value.mimeType || 'application/octet-stream' }), kind: value.kind, mimeType: value.mimeType };
}

contextBridge.exposeInMainWorld('__FLOVART_RESOLVE_BRIDGE__', {
  getContext: () => ipcRenderer.invoke('flovart:context'),
  getSelection: () => ipcRenderer.invoke('flovart:selection'),
  materializeClip: async ({ selection }) => bytesToBlob(await ipcRenderer.invoke('flovart:materialize-clip', { selection })),
  importArtifact: async ({ artifact, target }) => {
    const payload = { ...artifact, blob: undefined };
    if (artifact?.blob?.arrayBuffer) payload.bytes = Array.from(new Uint8Array(await artifact.blob.arrayBuffer()));
    return ipcRenderer.invoke('flovart:import-artifact', { artifact: payload, target });
  },
  subscribeContext: listener => {
    const handler = () => listener();
    ipcRenderer.on('flovart:context-changed', handler);
    return { dispose: () => ipcRenderer.removeListener('flovart:context-changed', handler) };
  },
});

contextBridge.exposeInMainWorld('__FLOVART_OPEN_CANVAS__', () => ipcRenderer.invoke('flovart:open-canvas'));
