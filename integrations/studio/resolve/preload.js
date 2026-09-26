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
    // Uint8Array 走结构化克隆，避免大产物先展开成普通数组造成内存/耗时放大。
    if (artifact?.blob?.arrayBuffer) payload.bytes = new Uint8Array(await artifact.blob.arrayBuffer());
    return ipcRenderer.invoke('flovart:import-artifact', { artifact: payload, target });
  },
  // 不暴露 subscribeContext：主进程不产生 context-changed 事件，让 host-contract
  // 的 bridgeAdapter 落到轮询回退（同 Photoshop/Premiere 面板），上下文才能真的刷新。
});

contextBridge.exposeInMainWorld('__FLOVART_OPEN_CANVAS__', () => ipcRenderer.invoke('flovart:open-canvas'));
