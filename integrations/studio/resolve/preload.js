const { contextBridge, ipcRenderer } = require('electron');
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

function bytesToBlob(value) {
  if (!value?.base64) return value;
  const binary = atob(value.base64);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return { blob: new Blob([bytes], { type: value.mimeType || 'application/octet-stream' }), kind: value.kind, mimeType: value.mimeType };
}

async function artifactPayload(artifact, includeBytes) {
  const payload = { ...artifact, blob: undefined };
  if (includeBytes && artifact?.blob?.arrayBuffer) {
    if (artifact.blob.size > MAX_ARTIFACT_BYTES) throw new Error('Resolve 产物超过 64 MB 的本地面板传输上限。');
    payload.bytes = new Uint8Array(await artifact.blob.arrayBuffer());
  }
  return payload;
}

contextBridge.exposeInMainWorld('__FLOVART_RESOLVE_BRIDGE__', {
  getContext: () => ipcRenderer.invoke('flovart:context'),
  getSelection: () => ipcRenderer.invoke('flovart:selection'),
  materializeClip: async ({ selection }) => bytesToBlob(await ipcRenderer.invoke('flovart:materialize-clip', { selection })),
  persistArtifact: async ({ artifact }) => {
    const payload = await artifactPayload(artifact, true);
    return ipcRenderer.invoke('flovart:persist-artifact', { artifact: payload });
  },
  importArtifact: async ({ artifact, target, persistence }) => {
    const payload = await artifactPayload(artifact, !persistence);
    return ipcRenderer.invoke('flovart:import-artifact', { artifact: payload, target, persistence });
  },
  artifactDir: () => ipcRenderer.invoke('flovart:artifact-dir'),
  // Resolve's own UI language is not exposed to the panel; use the OS/app locale.
  locale: () => ipcRenderer.invoke('flovart:locale'),
  // 不暴露 subscribeContext：主进程不产生 context-changed 事件，让 host-contract
  // 的 bridgeAdapter 落到轮询回退（同 Photoshop/Premiere 面板），上下文才能真的刷新。
});

contextBridge.exposeInMainWorld('__FLOVART_OPEN_CANVAS__', () => ipcRenderer.invoke('flovart:open-canvas'));
